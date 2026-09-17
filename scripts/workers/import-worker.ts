import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { contactLists, contacts, importJobs, suppressions } from "../../src/db/schema";
import { importStagingRows } from "../../src/db/import-schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { isValidEmail, normalizeEmail } from "../../src/lib/contact-utils";

const intervalMs = Math.max(1000, Number(process.env.IMPORT_WORKER_INTERVAL_MS || "3000"));
const batchSize = Math.min(500, Math.max(25, Number(process.env.IMPORT_WORKER_BATCH_SIZE || "250")));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function heartbeat(metadata: Record<string, unknown>) { await db.insert(workerHeartbeats).values({ workerName: "import", metadata }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata } }); }
async function importListId(jobId: string) { const result = await pool.query<{ list_id: string | null }>("select list_id from import_jobs where id=$1", [jobId]); return result.rows[0]?.list_id || null; }
async function attachToList(contactId: string, listId: string | null) { if (!listId) return; await db.insert(contactLists).values({ contactId, listId }).onConflictDoNothing({ target: [contactLists.contactId, contactLists.listId] }); }

async function runOnce() {
  const [job] = await db.select().from(importJobs).where(sql`${importJobs.status} in ('pending','processing')`).orderBy(importJobs.createdAt).limit(1);
  if (!job) { await heartbeat({ state: "idle" }); return; }
  if (job.status === "pending") await db.update(importJobs).set({ status: "processing" }).where(eq(importJobs.id, job.id));

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

    const inserted = await db.insert(contacts).values({ email: item.email.trim(), normalizedEmail, firstName: item.firstName?.trim() || null, lastName: item.lastName?.trim() || null, source: "csv_import", consentStatus, consentSource }).onConflictDoNothing({ target: contacts.normalizedEmail }).returning({ id: contacts.id });
    let contactId = inserted[0]?.id; let result: "imported" | "duplicate" = "imported";
    if (!contactId) {
      const [existing] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.normalizedEmail, normalizedEmail)).limit(1);
      contactId = existing?.id; result = "duplicate";
      if (contactId) await db.update(contacts).set({ consentStatus, consentSource, updatedAt: new Date() }).where(eq(contacts.id, contactId));
    }
    if (contactId) await attachToList(contactId, listId);
    await db.update(importStagingRows).set({ processed: true, result, detail: contactId ? null : "contact_lookup_failed" }).where(eq(importStagingRows.id, row.id));
  }

  const counts = await db.execute(sql`select count(*) filter(where result='imported')::int as imported,count(*) filter(where result='duplicate')::int as duplicates,count(*) filter(where result='invalid')::int as invalid,count(*) filter(where result='suppressed')::int as suppressed,count(*) filter(where processed=false)::int as remaining from import_staging_rows where job_id=${job.id}`);
  const countRow = (counts.rows[0] || {}) as Record<string, unknown>;
  const imported = Number(countRow.imported || 0), duplicates = Number(countRow.duplicates || 0), invalid = Number(countRow.invalid || 0), suppressed = Number(countRow.suppressed || 0), remaining = Number(countRow.remaining || 0);
  await db.update(importJobs).set({ importedRows: imported, duplicateRows: duplicates, invalidRows: invalid, errorMessage: suppressed ? `${suppressed} globally suppressed row(s) skipped` : null, ...(remaining === 0 ? { status: "completed" as const, completedAt: new Date() } : {}) }).where(eq(importJobs.id, job.id));
  await heartbeat({ state: remaining ? "processing" : "idle", jobId: job.id, listId, imported, duplicates, invalid, suppressed, remaining });
}

async function main() { console.log(`[import-worker] started, batch=${batchSize}`); while (true) { try { await runOnce(); } catch (error) { console.error("[import-worker]", error); await heartbeat({ state: "error" }).catch(() => {}); } await sleep(intervalMs); } }
main().catch(console.error);
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
