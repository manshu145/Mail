import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { contactLists, contactTags, contacts, importJobs, suppressions, tags } from "../../src/db/schema";
import { importStagingRows, importUploads } from "../../src/db/import-schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { isValidEmail, normalizeEmail } from "../../src/lib/contact-utils";
import { buildImportRow, parseCsv } from "../../src/lib/csv-import";

const intervalMs = Math.max(1000, Number(process.env.IMPORT_WORKER_INTERVAL_MS || "3000"));
const batchSize = Math.min(500, Math.max(25, Number(process.env.IMPORT_WORKER_BATCH_SIZE || "250")));
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
  const matrix = parseCsv(upload.content);
  const headers = upload.headers.length ? upload.headers : (matrix[0] || []);
  const values = matrix.slice(1);
  for (let offset = 0; offset < values.length; offset += 500) {
    const chunk = values.slice(offset, offset + 500).map((row, index) => ({ jobId, rowNumber: offset + index + 2, payload: buildImportRow(headers, row, upload.mapping, upload.options) }));
    if (chunk.length) await db.insert(importStagingRows).values(chunk);
  }
  await db.execute(sql`update import_jobs set total_rows=${values.length}, started_at=coalesce(started_at, now()) where id=${jobId}`);
}

async function runOnce() {
  const [job] = await db.select().from(importJobs).where(sql`${importJobs.status} in ('pending','processing')`).orderBy(importJobs.createdAt).limit(1);
  if (!job) { await heartbeat({ state: "idle" }); return; }
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
  }

  const counts = await db.execute(sql`select count(*) filter(where result='imported')::int as imported,count(*) filter(where result='duplicate')::int as duplicates,count(*) filter(where result='invalid')::int as invalid,count(*) filter(where result='suppressed')::int as suppressed,count(*) filter(where processed=false)::int as remaining from import_staging_rows where job_id=${job.id}`);
  const countRow = (counts.rows[0] || {}) as Record<string, unknown>;
  const imported = Number(countRow.imported || 0), duplicates = Number(countRow.duplicates || 0), invalid = Number(countRow.invalid || 0), suppressed = Number(countRow.suppressed || 0), remaining = Number(countRow.remaining || 0);
  await db.update(importJobs).set({ importedRows: imported, duplicateRows: duplicates, invalidRows: invalid, errorMessage: null, ...(remaining === 0 ? { status: "completed" as const, completedAt: new Date() } : {}) }).where(eq(importJobs.id, job.id));
  await db.execute(sql`update import_jobs set suppressed_rows=${suppressed} where id=${job.id}`);
  await heartbeat({ state: remaining ? "processing" : "idle", jobId: job.id, listId, imported, duplicates, invalid, suppressed, remaining });
}

async function main() { console.log(`[import-worker] started, batch=${batchSize}`); while (true) { try { await runOnce(); } catch (error) { console.error("[import-worker]", error); await heartbeat({ state: "error" }).catch(() => {}); } await sleep(intervalMs); } }
main().catch(console.error);
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
