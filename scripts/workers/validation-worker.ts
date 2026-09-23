import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { contacts, suppressions, systemSettings, validationJobs, validationResults } from "../../src/db/schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { normalizeEmail } from "../../src/lib/contact-utils";
import { isDirectGmailAddress, type ValidationVerdict } from "../../src/lib/validation-policy";
import { validateMailboxInternally } from "../../src/lib/mailbox-validator";
import { decryptWorkspaceSecret } from "../../src/lib/secure-setting";

const intervalMs = Math.max(15000, Number(process.env.VALIDATION_INTERVAL_MS || "30000"));
const timeoutMs = Math.max(3000, Number(process.env.VALIDATION_API_TIMEOUT_MS || "10000"));
const supersendEndpoint = String(process.env.SUPERSEND_VERIFY_URL || "https://api.supersend.io/v2/email-validation/verify").trim();
const supersendFallbackEnabled = process.env.SUPERSEND_FALLBACK_ENABLED === "true";
const validationProbeDelayMs = Math.max(250, Math.min(10_000, Number(process.env.VALIDATION_PROBE_DELAY_MS || "1500")));

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

type ExistingResult = {
  contact_id: string;
  email: string;
  status: "pending" | "accepted" | "valid" | "invalid" | "unknown" | "error";
  detail: string | null;
};

async function heartbeat(meta: Record<string, unknown> = {}) {
  await db.insert(workerHeartbeats).values({ workerName: "validation", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } });
}

function classifySupersendPayload(body: unknown): ValidationVerdict {
  const data = body && typeof body === "object" && "data" in body
    ? (body as { data?: unknown }).data
    : null;
  if (!data || typeof data !== "object") return { status: "unknown", detail: "supersend_v2_missing_data" };

  const record = data as Record<string, unknown>;
  if (record.is_disallowed === true) return { status: "invalid", detail: "supersend_v2_disallowed" };
  if (record.valid === true) return { status: "valid", detail: "supersend_v2_valid" };
  if (record.valid === false) return { status: "invalid", detail: "supersend_v2_invalid" };
  return { status: "unknown", detail: "supersend_v2_ambiguous" };
}

async function configuredSupersendApiKey() {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings)
    .where(eq(systemSettings.key, "validation.supersend_api_key")).limit(1);
  return decryptWorkspaceSecret(row?.value) || String(process.env.SUPERSEND_API_KEY || "").trim() || null;
}

async function verifyWithSupersend(email: string, apiKey: string): Promise<ValidationVerdict> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(supersendEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    });

    const body = await response.json().catch(() => null) as unknown;

    if (!response.ok) {
      const detail = body && typeof body === "object"
        ? JSON.stringify(body).slice(0, 240)
        : "";
      return {
        status: response.status === 402 ? "error" : response.status >= 500 || response.status === 429 ? "unknown" : "error",
        detail: `supersend_http_${response.status}:${detail}`,
      };
    }

    return classifySupersendPayload(body);
  } catch (error) {
    return {
      status: "unknown",
      detail: error instanceof Error && error.name === "AbortError"
        ? "supersend_timeout"
        : "supersend_request_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function validationPaused() {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, "validation_paused")).limit(1);
  return row?.value === true;
}

type ValidationContact = { id: string; email: string; normalizedEmail: string };

const validationBatchSize = Math.max(10, Math.min(500, Number(process.env.VALIDATION_BATCH_SIZE || "100")));

async function contactsForJob(scope: string, jobId: string, limit = validationBatchSize): Promise<ValidationContact[]> {
  if (scope.startsWith("contact:")) {
    const contactId = scope.slice("contact:".length);
    if (!/^[0-9a-f-]{36}$/i.test(contactId)) return [];
    const result = await pool.query<ValidationContact>(`
      select c.id::text as id,c.email,c.normalized_email as "normalizedEmail"
      from contacts c
      where c.id=$1
        and c.status='active'
        and c.validation_status in ('pending','unknown','error')
        and not exists(select 1 from validation_results vr where vr.job_id=$2 and vr.contact_id=c.id)
      limit $3
    `, [contactId, jobId, limit]);
    return result.rows;
  }

  if (scope.startsWith("import:")) {
    const importId = scope.slice("import:".length);
    if (!/^[0-9a-f-]{36}$/i.test(importId)) return [];
    const result = await pool.query<ValidationContact>(`
      select c.id::text as id,c.email,c.normalized_email as "normalizedEmail"
      from contacts c
      where c.status='active'
        and c.validation_status in ('pending','unknown','error')
        and exists(
          select 1
          from import_staging_rows s
          where s.job_id=$1 and s.contact_id=c.id
        )
        and not exists(
          select 1
          from validation_results vr
          where vr.job_id=$2 and vr.contact_id=c.id
        )
      order by c.id
      limit $3
    `, [importId, jobId, limit]);
    return result.rows;
  }

  if (scope === "gmail:pending" || scope === "gmail:unresolved") {
    const result = await pool.query<ValidationContact>(`
      select c.id::text as id,c.email,c.normalized_email as "normalizedEmail"
      from contacts c
      where c.status='active'
        and c.validation_status in ('pending','unknown','error')
        and lower(c.normalized_email) ~ '@(gmail|googlemail)\\.com$'
        and not exists(select 1 from validation_results vr where vr.job_id=$1 and vr.contact_id=c.id)
      order by c.id
      limit $2
    `, [jobId, limit]);
    return result.rows;
  }

  const result = await pool.query<ValidationContact>(`
    select c.id::text as id,c.email,c.normalized_email as "normalizedEmail"
    from contacts c
    where c.status='active'
      and c.validation_status in ('pending','unknown','error')
      and not exists(select 1 from validation_results vr where vr.job_id=$1 and vr.contact_id=c.id)
    order by c.id
    limit $2
  `, [jobId, limit]);
  return result.rows;
}

async function existingResultCount(jobId: string) {
  const result = await pool.query<{ total: number }>(`
    select count(distinct contact_id)::int as total
    from validation_results
    where job_id=$1 and contact_id is not null
  `, [jobId]);
  return Number(result.rows[0]?.total || 0);
}

async function remainingCountForJob(scope: string, jobId: string) {
  if (scope.startsWith("contact:")) {
    const contactId = scope.slice("contact:".length);
    if (!/^[0-9a-f-]{36}$/i.test(contactId)) return 0;
    const result = await pool.query<{ total: number }>(`
      select count(*)::int as total
      from contacts c
      where c.id=$1
        and c.status='active'
        and c.validation_status in ('pending','unknown','error')
        and not exists(select 1 from validation_results vr where vr.job_id=$2 and vr.contact_id=c.id)
    `, [contactId, jobId]);
    return Number(result.rows[0]?.total || 0);
  }

  if (scope.startsWith("import:")) {
    const importId = scope.slice("import:".length);
    if (!/^[0-9a-f-]{36}$/i.test(importId)) return 0;
    const result = await pool.query<{ total: number }>(`
      select count(distinct c.id)::int as total
      from contacts c
      where c.status='active'
        and c.validation_status in ('pending','unknown','error')
        and exists(
          select 1 from import_staging_rows s
          where s.job_id=$1 and s.contact_id=c.id
        )
        and not exists(
          select 1 from validation_results vr
          where vr.job_id=$2 and vr.contact_id=c.id
        )
    `, [importId, jobId]);
    return Number(result.rows[0]?.total || 0);
  }

  if (scope === "gmail:pending" || scope === "gmail:unresolved") {
    const result = await pool.query<{ total: number }>(`
      select count(*)::int as total
      from contacts c
      where c.status='active'
        and c.validation_status in ('pending','unknown','error')
        and lower(c.normalized_email) ~ '@(gmail|googlemail)\\.com
async function addInvalidSuppression(email: string, contactId: string, detail: string | null) {
  await db.insert(suppressions).values({
    email,
    normalizedEmail: normalizeEmail(email),
    contactId,
    reason: "invalid",
    source: "email_validation",
    note: detail,
  }).onConflictDoNothing({ target: suppressions.normalizedEmail });
}

async function syncImportValidationCounters(scope: string, validationJobId: string) {
  if (!scope.startsWith("import:")) return;
  const importId = scope.slice("import:".length);
  const result = await pool.query<{ valid: number; risky: number; invalid: number }>(`
    with latest as (
      select distinct on (contact_id) contact_id, status
      from validation_results
      where job_id=$1 and contact_id is not null
      order by contact_id, created_at desc
    )
    select
      count(*) filter(where status in ('accepted','valid'))::int as valid,
      count(*) filter(where status in ('unknown','error'))::int as risky,
      count(*) filter(where status='invalid')::int as invalid
    from latest
  `, [validationJobId]);
  const row = result.rows[0] || { valid: 0, risky: 0, invalid: 0 };
  await pool.query(`update import_jobs set valid_rows=$2, risky_rows=$3, validation_invalid_rows=$4 where id=$1`, [importId, Number(row.valid || 0), Number(row.risky || 0), Number(row.invalid || 0)]);
}

async function selectWorkJob() {
  // Interactive single-contact checks must not sit behind a multi-hour import.
  // A bulk job keeps its progress and resumes on the next cycle.
  let [job] = await db.select().from(validationJobs)
    .where(and(eq(validationJobs.status, "pending"), sql`${validationJobs.scope} like 'contact:%'`))
    .orderBy(validationJobs.createdAt).limit(1);
  if (job) return job;

  [job] = await db.select().from(validationJobs)
    .where(eq(validationJobs.status, "processing"))
    .orderBy(validationJobs.createdAt).limit(1);
  if (job) return job;

  [job] = await db.select().from(validationJobs)
    .where(eq(validationJobs.status, "pending"))
    .orderBy(validationJobs.createdAt).limit(1);
  return job;
}

async function runJob() {
  if (await validationPaused()) {
    await heartbeat({ state: "paused" });
    return;
  }
  const job = await selectWorkJob();
  if (!job) {
    await heartbeat({ state: "idle", provider: "internal_smtp", supersendFallbackEnabled });
    return;
  }

  const apiKey = supersendFallbackEnabled ? await configuredSupersendApiKey() : null;

  const resumed = job.status === "processing";
  if (!resumed) await db.update(validationJobs).set({ status: "processing" }).where(eq(validationJobs.id, job.id));

  let processed = await existingResultCount(job.id);
  const remainingCount = await remainingCountForJob(job.scope, job.id);
  const remaining = await contactsForJob(job.scope, job.id);
  // Recompute the denominator from the live scoped workload on every cycle.
  // This repairs legacy/stale job totals without changing which contacts are
  // eligible for validation.
  const total = processed + remainingCount;

  await db.update(validationJobs).set({ totalRows: total, processedRows: processed }).where(eq(validationJobs.id, job.id));
  await heartbeat({ state: resumed ? "resumed" : "processing", jobId: job.id, scope: job.scope, processed, total, batch: remaining.length });

  for (const contact of remaining) {
    if (await validationPaused()) {
      await heartbeat({ state: "paused", jobId: job.id, scope: job.scope, processed, total, remaining: total - processed });
      return;
    }
    let result = await validateMailboxInternally(contact.normalizedEmail, timeoutMs);

    if (
      (result.status === "unknown" || result.status === "error") &&
      supersendFallbackEnabled &&
      apiKey &&
      isDirectGmailAddress(contact.normalizedEmail)
    ) {
      const fallback = await verifyWithSupersend(contact.normalizedEmail, apiKey);
      if (fallback.status === "accepted" || fallback.status === "valid" || fallback.status === "invalid") {
        result = fallback;
      } else {
        result = { status: result.status, detail: `${result.detail};fallback:${fallback.detail}` };
      }
    }

    await db.insert(validationResults).values({ jobId: job.id, contactId: contact.id, email: contact.email, status: result.status, detail: result.detail });
    await db.update(contacts).set({ validationStatus: result.status, updatedAt: new Date() }).where(eq(contacts.id, contact.id));
    if (result.status === "invalid") await addInvalidSuppression(contact.email, contact.id, result.detail);
    processed++;
    await db.update(validationJobs).set({ processedRows: processed }).where(eq(validationJobs.id, job.id));
    await heartbeat({ state: "processing", jobId: job.id, scope: job.scope, processed, total, resumed, probeDelayMs: validationProbeDelayMs });
    if (!job.scope.startsWith("contact:")) await sleep(validationProbeDelayMs);
  }

  const hasMore = (await contactsForJob(job.scope, job.id, 1)).length > 0;
  if (hasMore) {
    await db.update(validationJobs).set({ processedRows: processed }).where(eq(validationJobs.id, job.id));
    await heartbeat({ state: "processing", jobId: job.id, scope: job.scope, processed, total, batchComplete: true, resumed });
    return;
  }

  await db.update(validationJobs).set({ status: "completed", processedRows: processed, totalRows: processed, completedAt: new Date() }).where(eq(validationJobs.id, job.id));
  await syncImportValidationCounters(job.scope, job.id);
  await heartbeat({ state: "idle", lastJobId: job.id, scope: job.scope, processed, resumed });
}

async function runWithWorkerLock() {
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>(`select pg_try_advisory_lock(hashtext('neximail-validation-worker')) as locked`);
    locked = Boolean(result.rows[0]?.locked);
    if (!locked) return;
    await runJob();
  } finally {
    if (locked) await client.query(`select pg_advisory_unlock(hashtext('neximail-validation-worker'))`).catch(() => {});
    client.release();
  }
}

async function main() {
  console.log("[validation-worker] started; internal SMTP mailbox validation primary; SuperSend optional fallback");
  while (true) {
    try { await runWithWorkerLock(); }
    catch (error) { console.error("[validation-worker]", error); await heartbeat({ state: "error" }).catch(()=>{}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async()=>{ await pool.end(); process.exit(0); });

        and not exists(select 1 from validation_results vr where vr.job_id=$1 and vr.contact_id=c.id)
    `, [jobId]);
    return Number(result.rows[0]?.total || 0);
  }

  const result = await pool.query<{ total: number }>(`
    select count(*)::int as total
    from contacts c
    where c.status='active'
      and c.validation_status in ('pending','unknown','error')
      and not exists(select 1 from validation_results vr where vr.job_id=$1 and vr.contact_id=c.id)
  `, [jobId]);
  return Number(result.rows[0]?.total || 0);
}

async function addInvalidSuppression(email: string, contactId: string, detail: string | null) {
  await db.insert(suppressions).values({
    email,
    normalizedEmail: normalizeEmail(email),
    contactId,
    reason: "invalid",
    source: "email_validation",
    note: detail,
  }).onConflictDoNothing({ target: suppressions.normalizedEmail });
}

async function syncImportValidationCounters(scope: string, validationJobId: string) {
  if (!scope.startsWith("import:")) return;
  const importId = scope.slice("import:".length);
  const result = await pool.query<{ valid: number; risky: number; invalid: number }>(`
    with latest as (
      select distinct on (contact_id) contact_id, status
      from validation_results
      where job_id=$1 and contact_id is not null
      order by contact_id, created_at desc
    )
    select
      count(*) filter(where status in ('accepted','valid'))::int as valid,
      count(*) filter(where status in ('unknown','error'))::int as risky,
      count(*) filter(where status='invalid')::int as invalid
    from latest
  `, [validationJobId]);
  const row = result.rows[0] || { valid: 0, risky: 0, invalid: 0 };
  await pool.query(`update import_jobs set valid_rows=$2, risky_rows=$3, validation_invalid_rows=$4 where id=$1`, [importId, Number(row.valid || 0), Number(row.risky || 0), Number(row.invalid || 0)]);
}

async function selectWorkJob() {
  // Interactive single-contact checks must not sit behind a multi-hour import.
  // A bulk job keeps its progress and resumes on the next cycle.
  let [job] = await db.select().from(validationJobs)
    .where(and(eq(validationJobs.status, "pending"), sql`${validationJobs.scope} like 'contact:%'`))
    .orderBy(validationJobs.createdAt).limit(1);
  if (job) return job;

  [job] = await db.select().from(validationJobs)
    .where(eq(validationJobs.status, "processing"))
    .orderBy(validationJobs.createdAt).limit(1);
  if (job) return job;

  [job] = await db.select().from(validationJobs)
    .where(eq(validationJobs.status, "pending"))
    .orderBy(validationJobs.createdAt).limit(1);
  return job;
}

async function runJob() {
  if (await validationPaused()) {
    await heartbeat({ state: "paused" });
    return;
  }
  const job = await selectWorkJob();
  if (!job) {
    await heartbeat({ state: "idle", provider: "internal_smtp", supersendFallbackEnabled });
    return;
  }

  const apiKey = supersendFallbackEnabled ? await configuredSupersendApiKey() : null;

  const resumed = job.status === "processing";
  if (!resumed) await db.update(validationJobs).set({ status: "processing" }).where(eq(validationJobs.id, job.id));

  let processed = await existingResultCount(job.id);
  const remaining = await contactsForJob(job.scope, job.id);
  const total = Math.max(Number(job.totalRows || 0), processed + remaining.length);

  await db.update(validationJobs).set({ totalRows: total, processedRows: processed }).where(eq(validationJobs.id, job.id));
  await heartbeat({ state: resumed ? "resumed" : "processing", jobId: job.id, scope: job.scope, processed, total, batch: remaining.length });

  for (const contact of remaining) {
    if (await validationPaused()) {
      await heartbeat({ state: "paused", jobId: job.id, scope: job.scope, processed, total, remaining: total - processed });
      return;
    }
    let result = await validateMailboxInternally(contact.normalizedEmail, timeoutMs);

    if (
      (result.status === "unknown" || result.status === "error") &&
      supersendFallbackEnabled &&
      apiKey &&
      isDirectGmailAddress(contact.normalizedEmail)
    ) {
      const fallback = await verifyWithSupersend(contact.normalizedEmail, apiKey);
      if (fallback.status === "accepted" || fallback.status === "valid" || fallback.status === "invalid") {
        result = fallback;
      } else {
        result = { status: result.status, detail: `${result.detail};fallback:${fallback.detail}` };
      }
    }

    await db.insert(validationResults).values({ jobId: job.id, contactId: contact.id, email: contact.email, status: result.status, detail: result.detail });
    await db.update(contacts).set({ validationStatus: result.status, updatedAt: new Date() }).where(eq(contacts.id, contact.id));
    if (result.status === "invalid") await addInvalidSuppression(contact.email, contact.id, result.detail);
    processed++;
    await db.update(validationJobs).set({ processedRows: processed }).where(eq(validationJobs.id, job.id));
    await heartbeat({ state: "processing", jobId: job.id, scope: job.scope, processed, total, resumed, probeDelayMs: validationProbeDelayMs });
    if (!job.scope.startsWith("contact:")) await sleep(validationProbeDelayMs);
  }

  const hasMore = (await contactsForJob(job.scope, job.id, 1)).length > 0;
  if (hasMore) {
    await db.update(validationJobs).set({ processedRows: processed }).where(eq(validationJobs.id, job.id));
    await heartbeat({ state: "processing", jobId: job.id, scope: job.scope, processed, total, batchComplete: true, resumed });
    return;
  }

  await db.update(validationJobs).set({ status: "completed", processedRows: processed, totalRows: processed, completedAt: new Date() }).where(eq(validationJobs.id, job.id));
  await syncImportValidationCounters(job.scope, job.id);
  await heartbeat({ state: "idle", lastJobId: job.id, scope: job.scope, processed, resumed });
}

async function runWithWorkerLock() {
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>(`select pg_try_advisory_lock(hashtext('neximail-validation-worker')) as locked`);
    locked = Boolean(result.rows[0]?.locked);
    if (!locked) return;
    await runJob();
  } finally {
    if (locked) await client.query(`select pg_advisory_unlock(hashtext('neximail-validation-worker'))`).catch(() => {});
    client.release();
  }
}

async function main() {
  console.log("[validation-worker] started; internal SMTP mailbox validation primary; SuperSend optional fallback");
  while (true) {
    try { await runWithWorkerLock(); }
    catch (error) { console.error("[validation-worker]", error); await heartbeat({ state: "error" }).catch(()=>{}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async()=>{ await pool.end(); process.exit(0); });
