import { unlink } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { contactLists, contactTags, contacts, importJobs, suppressions, tags, validationJobs } from "../../src/db/schema";
import { importStagingRows, importUploads } from "../../src/db/import-schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { isValidEmail, normalizeEmail } from "../../src/lib/contact-utils";
import { buildImportRow, iterateCsvRows } from "../../src/lib/csv-import";
import { iterateCsvFileRows } from "../../src/lib/csv-file";

const intervalMs = Math.max(1000, Number(process.env.IMPORT_WORKER_INTERVAL_MS || "3000"));
const batchSize = Math.min(1000, Math.max(50, Number(process.env.IMPORT_WORKER_BATCH_SIZE || "500")));
const stageBatchSize = Math.min(2000, Math.max(250, Number(process.env.IMPORT_STAGE_BATCH_SIZE || "1000")));
const retentionDays = Math.max(1, Number(process.env.IMPORT_HISTORY_RETENTION_DAYS || "30"));
const maxImportRows = Math.max(1, Number(process.env.IMPORT_MAX_ROWS || "1000000"));
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

async function* uploadRows(upload: typeof importUploads.$inferSelect) {
  if (upload.storagePath) {
    for await (const row of iterateCsvFileRows(upload.storagePath)) yield row;
    return;
  }
  for (const row of iterateCsvRows(upload.content)) yield row;
}

async function stageStoredUpload(jobId: string) {
  const [upload] = await db.select().from(importUploads).where(eq(importUploads.jobId, jobId)).limit(1);
  const existingResult = await db.execute(sql`select count(*)::int as count from import_staging_rows where job_id=${jobId}`);
  const existingCount = Number((existingResult.rows[0] as Record<string, unknown> | undefined)?.count || 0);

  if (!upload || (!upload.storagePath && !upload.content)) {
    if (existingCount > 0) return existingCount;
    await db.update(importJobs).set({ status: "failed", errorMessage: "Stored CSV payload is missing.", completedAt: new Date() }).where(eq(importJobs.id, jobId));
    await heartbeat({ state: "failed", jobId, error: "import_upload_missing" });
    return 0;
  }

  let headers: string[] | null = upload.headers.length ? upload.headers : null;
  let headerConsumed = false;
  let dataRow = 0;
  let newlyStaged = 0;
  let chunk: Array<{ jobId: string; rowNumber: number; payload: ReturnType<typeof buildImportRow> }> = [];

  try {
    for await (const row of uploadRows(upload)) {
      if (!headers) {
        headers = row.map((value) => value.trim());
        headerConsumed = true;
        continue;
      }
      if (!headerConsumed && row.map((value) => value.trim()).join("\u0001") === headers.join("\u0001")) {
        headerConsumed = true;
        continue;
      }
      headerConsumed = true;
      if (!row.some((value) => value.trim())) continue;
      dataRow++;
      if (dataRow > maxImportRows) {
        await db.update(importJobs).set({ status: "failed", errorMessage: `A single import can contain up to ${maxImportRows.toLocaleString()} data rows.`, completedAt: new Date() }).where(eq(importJobs.id, jobId));
        await heartbeat({ state: "failed", jobId, error: "row_limit_exceeded", rows: dataRow, maxImportRows });
        return 0;
      }

      // Existing staging rows are a durable checkpoint. On restart we replay the
      // source from the beginning and skip exactly the rows already committed.
      if (dataRow <= existingCount) continue;

      // Keep the existing row-number convention stable for jobs created by older releases.
      const rowNumber = dataRow + 2;
      chunk.push({ jobId, rowNumber, payload: buildImportRow(headers, row, upload.mapping, upload.options) });
      if (chunk.length >= stageBatchSize) {
        await db.insert(importStagingRows).values(chunk).onConflictDoNothing({ target: [importStagingRows.jobId, importStagingRows.rowNumber] });
        newlyStaged += chunk.length;
        chunk = [];
        const staged = existingCount + newlyStaged;
        await db.update(importJobs).set({ totalRows: staged }).where(eq(importJobs.id, jobId));
        await heartbeat({ state: "staging", jobId, staged, sourceRowsSeen: dataRow, storage: upload.storagePath ? "disk_spool" : "legacy_database" });
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "csv_spool_read_failed";
    await db.update(importJobs).set({ status: "failed", errorMessage: `Could not read stored CSV: ${detail}`.slice(0, 1000), completedAt: new Date() }).where(eq(importJobs.id, jobId));
    await heartbeat({ state: "failed", jobId, error: "csv_spool_read_failed", detail });
    return 0;
  }

  if (chunk.length) {
    await db.insert(importStagingRows).values(chunk).onConflictDoNothing({ target: [importStagingRows.jobId, importStagingRows.rowNumber] });
    newlyStaged += chunk.length;
  }

  const finalResult = await db.execute(sql`select count(*)::int as count from import_staging_rows where job_id=${jobId}`);
  const stagedTotal = Number((finalResult.rows[0] as Record<string, unknown> | undefined)?.count || 0);
  await db.execute(sql`update import_jobs set total_rows=${stagedTotal}, started_at=coalesce(started_at, now()) where id=${jobId}`);
  return stagedTotal;
}

async function queueScopedValidation(jobId: string) {
  const state = await pool.query<{ validation_job_id: string | null; options: { queueValidation?: boolean } | null }>(`
    select j.validation_job_id, u.options
    from import_jobs j
    left join import_uploads u on u.job_id=j.id
    where j.id=$1
  `, [jobId]);
  const row = state.rows[0];
  if (!row || row.validation_job_id || row.options?.queueValidation !== true) return;

  const count = await pool.query<{ total: number }>(`
    select count(distinct c.id)::int as total
    from import_staging_rows s
    join contacts c on c.id=s.contact_id
    where s.job_id=$1
      and c.status='active'
      and c.validation_status in ('pending','unknown','error')
      and lower(c.normalized_email) ~ '@(gmail|googlemail)\\.com$'
  `, [jobId]);
  const total = Number(count.rows[0]?.total || 0);
  const [validationJob] = await db.insert(validationJobs).values({ scope: `import:${jobId}`, totalRows: total }).returning({ id: validationJobs.id });
  await pool.query(`update import_jobs set validation_job_id=$2 where id=$1 and validation_job_id is null`, [jobId, validationJob.id]);
}

async function cleanupHistory() {
  const old = await pool.query<{ id: string; storage_path: string | null }>(`
    select j.id, u.storage_path
    from import_jobs j
    left join import_uploads u on u.job_id=j.id
    where j.status in ('completed','failed')
      and coalesce(j.completed_at, j.created_at) < now() - ($1::int * interval '1 day')
    limit 100
  `, [retentionDays]);
  for (const row of old.rows) {
    if (row.storage_path) await unlink(row.storage_path).catch(() => {});
    await pool.query(`delete from import_jobs where id=$1`, [row.id]);
  }
  return old.rowCount || 0;
}

async function nextJob() {
  const result = await pool.query<{ id: string }>(`
    select j.id
    from import_jobs j
    join import_uploads u on u.job_id=j.id
    where j.status in ('pending','processing')
      and (u.size_bytes > 0 or length(u.content) > 0)
    order by j.created_at
    limit 1
  `);
  if (!result.rows[0]?.id) return null;
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, result.rows[0].id)).limit(1);
  return job || null;
}

async function runOnce() {
  const job = await nextJob();
  if (!job) { const cleaned = await cleanupHistory(); await heartbeat({ state: "idle", cleaned }); return; }
  if (job.status === "pending") await db.update(importJobs).set({ status: "processing" }).where(eq(importJobs.id, job.id));

  const stagedTotal = await stageStoredUpload(job.id);
  const [freshJob] = await db.select({ status: importJobs.status }).from(importJobs).where(eq(importJobs.id, job.id)).limit(1);
  if (!freshJob || freshJob.status === "failed") return;
  if (stagedTotal === 0) {
    await db.update(importJobs).set({ status: "failed", errorMessage: "CSV contains no stageable data rows.", completedAt: new Date() }).where(eq(importJobs.id, job.id));
    return;
  }

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
    const inserted = await db.insert(contacts).values({
      email: item.email.trim(), normalizedEmail,
      firstName: item.firstName?.trim() || null,
      lastName: item.lastName?.trim() || null,
      source: item.source?.trim() || "csv_import",
      consentStatus, consentSource, attributes,
    }).onConflictDoNothing({ target: contacts.normalizedEmail }).returning({ id: contacts.id });

    let contactId = inserted[0]?.id;
    let result: "imported" | "duplicate" = "imported";
    if (!contactId) {
      const [existing] = await db.select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        source: contacts.source,
        consentStatus: contacts.consentStatus,
        consentSource: contacts.consentSource,
        attributes: contacts.attributes,
      }).from(contacts).where(eq(contacts.normalizedEmail, normalizedEmail)).limit(1);
      contactId = existing?.id;
      result = "duplicate";
      if (existing) {
        const keepConfirmedConsent = existing.consentStatus === "confirmed";
        const mergedAttributes = { ...(existing.attributes || {}), ...attributes };
        await db.update(contacts).set({
          firstName: item.firstName?.trim() || existing.firstName,
          lastName: item.lastName?.trim() || existing.lastName,
          source: existing.source,
          consentStatus: keepConfirmedConsent ? "confirmed" : consentStatus,
          consentSource: keepConfirmedConsent ? (existing.consentSource || consentSource) : consentSource,
          attributes: mergedAttributes,
          updatedAt: new Date(),
        }).where(eq(contacts.id, existing.id));
      }
    }

    if (contactId) { await attachToList(contactId, listId); await attachTags(contactId, item.tags); }
    await db.update(importStagingRows).set({ processed: true, result, detail: contactId ? null : "contact_lookup_failed", contactId: contactId || null }).where(eq(importStagingRows.id, row.id));
  }

  const counts = await db.execute(sql`select count(*) filter(where result='imported')::int as imported,count(*) filter(where result='duplicate')::int as duplicates,count(*) filter(where result='invalid')::int as invalid,count(*) filter(where result='suppressed')::int as suppressed,count(*) filter(where processed=false)::int as remaining from import_staging_rows where job_id=${job.id}`);
  const countRow = (counts.rows[0] || {}) as Record<string, unknown>;
  const imported = Number(countRow.imported || 0), duplicates = Number(countRow.duplicates || 0), invalid = Number(countRow.invalid || 0), suppressed = Number(countRow.suppressed || 0), remaining = Number(countRow.remaining || 0);
  await db.update(importJobs).set({ importedRows: imported, duplicateRows: duplicates, invalidRows: invalid, errorMessage: null, ...(remaining === 0 ? { status: "completed" as const, completedAt: new Date() } : {}) }).where(eq(importJobs.id, job.id));
  await db.execute(sql`update import_jobs set suppressed_rows=${suppressed} where id=${job.id}`);
  if (remaining === 0) await queueScopedValidation(job.id);
  await heartbeat({ state: remaining ? "processing" : "idle", jobId: job.id, listId, imported, duplicates, invalid, suppressed, remaining, stagedTotal });
}

async function runWithWorkerLock() {
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>(`select pg_try_advisory_lock(hashtext('neximail-import-worker')) as locked`);
    locked = Boolean(result.rows[0]?.locked);
    if (!locked) return;
    await runOnce();
  } finally {
    if (locked) await client.query(`select pg_advisory_unlock(hashtext('neximail-import-worker'))`).catch(() => {});
    client.release();
  }
}

async function main() { console.log(`[import-worker] started, batch=${batchSize}, stageBatch=${stageBatchSize}, retention=${retentionDays}d, maxRows=${maxImportRows}`); while (true) { try { await runWithWorkerLock(); } catch (error) { console.error("[import-worker]", error); await heartbeat({ state: "error" }).catch(() => {}); } await sleep(intervalMs); } }
main().catch(console.error);
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
