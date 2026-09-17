import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { contactLists, contactTags, contacts, importJobs, suppressions, tags, validationJobs } from "../../src/db/schema";
import { importStagingRows, importUploads } from "../../src/db/import-schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { isValidEmail, normalizeEmail } from "../../src/lib/contact-utils";
import { buildImportRow, iterateCsvRows } from "../../src/lib/csv-import";

const intervalMs = Math.max(1000, Number(process.env.IMPORT_WORKER_INTERVAL_MS || "3000"));
const batchSize = Math.min(1000, Math.max(50, Number(process.env.IMPORT_WORKER_BATCH_SIZE || "500")));
const stageBatchSize = Math.min(2000, Math.max(250, Number(process.env.IMPORT_STAGE_BATCH_SIZE || "1000")));
const retentionDays = Math.max(1, Number(process.env.IMPORT_HISTORY_RETENTION_DAYS || "30"));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function heartbeat(metadata: Record<string, unknown>) { await db.insert(workerHeartbeats).values({ workerName: "import", metadata }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata } }); }
async function importListId(jobId: string) { const result = await pool.query<{ list_id: string | null }>("select list_id from import_jobs where id=$1", [jobId]); return result.rows[0]?.list_id || null; }
async function attachToList(contactId: string, listId: string | null) { if (!listId) return; await db.insert(contactLists).values({ contactId, listId }).onConflictDoNothing({ target: [contactLists.contactId, contactLists.listId] }); }
async function attachTags(contactId: string, names: string[] = []) {
  for (const raw of names) {
    const name = raw.trim(); if (!name) continue;
    let [tag] = await db.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).limit(1);
    if (!tag) [tag] = await db.insert(tags).values({ name }).onConflictDoNothing({ target: tags.name }).returning({ id: tags.id });
    if (!tag) [tag] = await db.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).limit(1);
    if (tag) await db.insert(contactTags).values({ contactId, tagId: tag.id }).onConflictDoNothing({ target: [contactTags.contactId, contactTags.tagId] });
  }
}

async function stageStoredUpload(jobId: string) {
  const [existing] = await db.select({ id: importStagingRows.id }).from(importStagingRows).where(eq(importStagingRows.jobId, jobId)).limit(1);
  if (existing) return;
  const [upload] = await db.select().from(importUploads).where(eq(importUploads.jobId, jobId)).limit(1);
  if (!upload) return;

  let headers: string[] | null = upload.headers.length ? upload.headers : null;
  let dataRow = 0;
  let staged = 0;
  let chunk: Array<{ jobId: string; rowNumber: number; payload: ReturnType<typeof buildImportRow> }> = [];

  for (const row of iterateCsvRows(upload.content)) {
    if (!headers) { headers = row.map((value) => value.trim()); continue; }
    if (dataRow === 0 && row.map((value) => value.trim()).join("\u0001") === headers.join("\u0001")) { dataRow++; continue; }
    dataRow++;
    chunk.push({ jobId, rowNumber: dataRow + 1, payload: buildImportRow(headers, row, upload.mapping, upload.options) });
    if (chunk.length >= stageBatchSize) {
      await db.insert(importStagingRows).values(chunk);
      staged += chunk.length;
      chunk = [];
      await heartbeat({ state: "staging", jobId, staged, total: dataRow });
    }
  }
  if (chunk.length) { await db.insert(importStagingRows).values(chunk); staged += chunk.length; }
  await db.execute(sql`update import_jobs set total_rows=${staged}, started_at=coalesce(started_at, now()) where id=${jobId}`);
}

async function queueScopedValidation(jobId: string) {
  const state = await pool.query<{ validation_job_id: string | null; options: { queueValidation?: boolean } | null }>(`
    select j.validation_job_id, u.options
    from import_jobs j
    left join import_uploads u on u.job_id=j.id
    where j.id=$1
  `, [jobId]);
  const row = state.rows[0];
  if (!row || row.validation_job_id || row.options?.queueValidation === false) return;

  const count = await pool.query<{ total: number }>(`
    select count(distinct c.id)::int as total
    from import_staging_rows s
    join contacts c on c.id=s.contact_id
    where s.job_id=$1
      and lower(c.normalized_email) ~ '@(gmail|googlemail)\\.com$'
  `, [jobId]);
  const total = Number(count.rows[0]?.total || 0);
  const [validationJob] = await db.insert(validationJobs).values({ scope: `import:${jobId}`, totalRows: total }).returning({ id: validationJobs.id });
  await pool.query(`update import_jobs set validation_job_id=$2 where id=$1 and validation_job_id is null`, [jobId, validationJob.id]);
}

async function cleanupHistory() {
  const result = await pool.query<{ id: string }>(`
    delete from import_jobs
    where status in ('completed','failed')
      and coalesce(completed_at, created_at) < now() - ($1::int * interval '1 day')
    returning id
  `, [retentionDays]);
  return result.rowCount || 0;
}

async function runOnce() {
  const [job] = await db.select().from(importJobs).where(sql`${importJobs.status} in ('pending','processing')`).orderBy(importJobs.createdAt).limit(1);
  if (!job) { const cleaned = await cleanupHistory(); await heartbeat({ state: "idle", cleaned }); return; }
  if (job.status === "pending") await db.update(importJobs).set({ status: "processing" }).where(eq(importJobs.id, job.id));

  await stageStoredUpload(job.id);
  const listId = await importListId(job.id);
  const staged = await db.select().from(importStagingRows).where(and(eq(importStagingRows.jobId, job.id), eq(importStagingRows.processed, false))).orderBy(importStagingRows.rowNumber).limit(batchSize);

  for (const row of staged) {
    const item = row.payload;
    if (!item?.email || !isValidEmail(item.email)) { await db.update(importStagingRows).set({ processed: true, result: "invalid", detail: "invalid_email" }).where(eq(importStagingRows.id, row.id)); continue; }
    const consentSource = item.consentSource?.trim() || "";
    if (!consentSource) { await db.update(importStagingRows).set({ processed: true, result: "invalid", detail: "missing_consent_source" }).where(eq(importStagingRows.id, row.id)); continue; }
    const consentStatus = item.consentStatus === "confirmed" ? "confirmed" : "unconfirmed";
    const normalizedEmail = normalizeEmail(item.email);
    const [suppressed] = await db.select({ id: suppressions.id, reason: suppressions.reason }).from(suppressions).where(eq(suppressions.normalizedEmail, normalizedEmail)).limit(1);
    if (suppressed) { await db.update(importStagingRows).set({ processed: true, result: "suppressed", detail: String(suppressed.reason) }).where(eq(importStagingRows.id, row.id)); continue; }

    const attributes = { ...(item.attributes || {}), ...(item.categories?.length ? { categories: item.categories.join("|") } : {}) };
    const inserted = await db.insert(contacts).values({ email: item.email.trim(), normalizedEmail, firstName: item.firstName?.trim() || null, lastName: item.lastName?.trim() || null, source: item.source?.trim() || "csv_import", consentStatus, consentSource, attributes }).onConflictDoNothing({ target: contacts.normalizedEmail }).returning({ id: contacts.id });
    let contactId = inserted[0]?.id; let result: "imported" | "duplicate" = "imported";
    if (!contactId) {
      const [existing] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.normalizedEmail, normalizedEmail)).limit(1);
      contactId = existing?.id; result = "duplicate";
      if (contactId) await db.update(contacts).set({ consentStatus, consentSource, source: item.source?.trim() || "csv_import", attributes, updatedAt: new Date() }).where(eq(contacts.id, contactId));
    }
    if (contactId) { await attachToList(contactId, listId); await attachTags(contactId, item.tags); }
    await db.update(importStagingRows).set({ processed: true, result, detail: contactId ? null : "contact_lookup_failed" }).where(eq(importStagingRows.id, row.id));
    if (contactId) await pool.query(`update import_staging_rows set contact_id=$2 where id=$1`, [row.id, contactId]);
  }

  const counts = await db.execute(sql`select count(*) filter(where result='imported')::int as imported,count(*) filter(where result='duplicate')::int as duplicates,count(*) filter(where result='invalid')::int as invalid,count(*) filter(where result='suppressed')::int as suppressed,count(*) filter(where processed=false)::int as remaining from import_staging_rows where job_id=${job.id}`);
  const countRow = (counts.rows[0] || {}) as Record<string, unknown>;
  const imported = Number(countRow.imported || 0), duplicates = Number(countRow.duplicates || 0), invalid = Number(countRow.invalid || 0), suppressed = Number(countRow.suppressed || 0), remaining = Number(countRow.remaining || 0);
  await db.update(importJobs).set({ importedRows: imported, duplicateRows: duplicates, invalidRows: invalid, errorMessage: null, ...(remaining === 0 ? { status: "completed" as const, completedAt: new Date() } : {}) }).where(eq(importJobs.id, job.id));
  await db.execute(sql`update import_jobs set suppressed_rows=${suppressed} where id=${job.id}`);
  if (remaining === 0) await queueScopedValidation(job.id);
  await heartbeat({ state: remaining ? "processing" : "idle", jobId: job.id, listId, imported, duplicates, invalid, suppressed, remaining });
}

async function main() { console.log(`[import-worker] started, batch=${batchSize}, stageBatch=${stageBatchSize}, retention=${retentionDays}d`); while (true) { try { await runOnce(); } catch (error) { console.error("[import-worker]", error); await heartbeat({ state: "error" }).catch(() => {}); } await sleep(intervalMs); } }
main().catch(console.error);
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
