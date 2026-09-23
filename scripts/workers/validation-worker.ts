import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { contacts, suppressions, systemSettings, validationJobs, validationResults } from "../../src/db/schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { normalizeEmail } from "../../src/lib/contact-utils";
import type { ValidationVerdict } from "../../src/lib/validation-policy";
import { validateMailboxInternally } from "../../src/lib/mailbox-validator";
import { recipientDomain, recipientProvider, runProviderAwarePool, validationIsPreRecipientFailure } from "../../src/lib/validation-throughput";
import { decryptWorkspaceSecret } from "../../src/lib/secure-setting";
import { normalizeValidationMode, validationModeNeedsSupersend, type ValidationMode } from "../../src/lib/validation-provider";

const intervalMs = Math.max(2000, Number(process.env.VALIDATION_INTERVAL_MS || "5000"));
const timeoutMs = Math.max(3000, Number(process.env.VALIDATION_API_TIMEOUT_MS || "10000"));
const validationHardTimeoutMs = Math.max(timeoutMs, Math.min(120_000, Number(process.env.VALIDATION_HARD_TIMEOUT_MS || "45000")));

async function validateMailboxWithDeadline(email: string): Promise<ValidationVerdict> {
  return Promise.race([
    validateMailboxInternally(email, timeoutMs),
    new Promise<ValidationVerdict>((resolve) => setTimeout(
      () => resolve({ status: "unknown", detail: "smtp_validation_hard_timeout" }),
      validationHardTimeoutMs,
    )),
  ]);
}
const supersendEndpoint = String(process.env.SUPERSEND_VERIFY_URL || "https://api.supersend.io/v2/email-validation/verify").trim();

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
  const verdict = String(record.verdict || "").toLowerCase();
  const subtype = String(record.subtype || record.validation_subtype || "").trim().toLowerCase();
  if (record.is_disallowed === true) return { status: "invalid", detail: "supersend_v2_disallowed" };
  if (verdict === "valid") return { status: "valid", detail: subtype ? `supersend_v2_valid:${subtype}` : "supersend_v2_valid" };
  if (verdict === "invalid") return { status: "invalid", detail: subtype ? `supersend_v2_invalid:${subtype}` : "supersend_v2_invalid" };
  if (verdict === "risky") return { status: "unknown", detail: subtype ? `supersend_v2_risky:${subtype}` : "supersend_v2_risky" };
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

let cachedPaused = false;
let pausedCheckedAt = 0;
async function validationPaused(force = false) {
  const now = Date.now();
  if (!force && now - pausedCheckedAt < 2000) return cachedPaused;
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, "validation_paused")).limit(1);
  cachedPaused = row?.value === true;
  pausedCheckedAt = now;
  return cachedPaused;
}

type ValidationContact = { id: string; email: string; normalizedEmail: string };

const validationBatchSize = Math.max(25, Math.min(1000, Number(process.env.VALIDATION_BATCH_SIZE || "250")));
const validationConcurrency = Math.max(1, Math.min(24, Number(process.env.VALIDATION_CONCURRENCY || "12")));
const validationProviderStartGapMs = Math.max(250, Math.min(10_000, Number(process.env.VALIDATION_PROVIDER_START_GAP_MS || "750")));
const validationProviderBackoffMs = Math.max(validationProviderStartGapMs, Math.min(120_000, Number(process.env.VALIDATION_PROVIDER_BACKOFF_MS || "15000")));
const validationProviderHoldMs = Math.max(validationProviderBackoffMs, Math.min(3_600_000, Number(process.env.VALIDATION_PROVIDER_HOLD_MS || "600000")));
const providerHoldUntil = new Map<string, number>();

function providerLaneCount(provider: string) {
  if (provider === "google") return Math.max(1, Math.min(4, Number(process.env.VALIDATION_GOOGLE_LANES || "3")));
  if (provider === "yahoo") return Math.max(1, Math.min(4, Number(process.env.VALIDATION_YAHOO_LANES || "2")));
  if (provider === "microsoft") return Math.max(1, Math.min(3, Number(process.env.VALIDATION_MICROSOFT_LANES || "2")));
  if (provider === "rediff") return Math.max(1, Math.min(3, Number(process.env.VALIDATION_REDIFF_LANES || "2")));
  return 1;
}

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
        and exists(select 1 from import_staging_rows s where s.job_id=$1 and s.contact_id=c.id)
        and not exists(select 1 from validation_results vr where vr.job_id=$2 and vr.contact_id=c.id)
    `, [importId, jobId]);
    return Number(result.rows[0]?.total || 0);
  }

  if (scope === "gmail:pending" || scope === "gmail:unresolved") {
    const result = await pool.query<{ total: number }>(`
      select count(*)::int as total
      from contacts c
      where c.status='active'
        and c.validation_status in ('pending','unknown','error')
        and lower(split_part(c.normalized_email,'@',2)) in ('gmail.com','googlemail.com')
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
  if (await validationPaused(true)) {
    await heartbeat({ state: "paused" });
    return;
  }
  const job = await selectWorkJob();
  if (!job) {
    await heartbeat({ state: "idle", provider: "selectable", concurrency: validationConcurrency, scheduler: "provider_aware" });
    return;
  }

  const validationMode = normalizeValidationMode(job.validationMode);
  const apiKey = validationModeNeedsSupersend(validationMode) ? await configuredSupersendApiKey() : null;
  if (validationModeNeedsSupersend(validationMode) && !apiKey) {
    await heartbeat({
      state: "configuration_error",
      jobId: job.id,
      scope: job.scope,
      validationMode,
      detail: "supersend_api_key_missing",
    });
    return;
  }
  const resumed = job.status === "processing";
  if (!resumed) await db.update(validationJobs).set({ status: "processing" }).where(eq(validationJobs.id, job.id));

  // A banner/HELO/MAIL FROM/connection failure happens before the recipient
  // mailbox is actually evaluated. Requeue transient rows written by older
  // builds so a provider-side block does not permanently consume recipients.
  await pool.query(`
    delete from validation_results
    where job_id=$1
      and status='unknown'
      and (
        detail like 'smtp_banner_%'
        or detail like 'smtp_helo_%'
        or detail like 'smtp_mail_from_%'
        or detail in ('smtp_validation_timeout','smtp_validation_connection_failed')
      )
  `, [job.id]);

  let processed = await existingResultCount(job.id);
  const remainingCount = await remainingCountForJob(job.scope, job.id);
  const remaining = await contactsForJob(job.scope, job.id);
  const total = processed + remainingCount;

  await db.update(validationJobs).set({ totalRows: total, processedRows: processed }).where(eq(validationJobs.id, job.id));
  await heartbeat({
    state: resumed ? "resumed" : "processing", jobId: job.id, scope: job.scope, processed, total,
    batch: remaining.length, concurrency: validationConcurrency, scheduler: "provider_aware",
    validationMode, providerStartGapMs: validationMode === "supersend" ? 250 : validationProviderStartGapMs,
  });

  let lastProgressPublish = 0;
  const publishProgress = async (force = false) => {
    const now = Date.now();
    if (!force && processed % 10 !== 0 && now - lastProgressPublish < 2000) return;
    lastProgressPublish = now;
    await pool.query(`update validation_jobs set processed_rows=greatest(processed_rows,$2), total_rows=greatest(total_rows,$3) where id=$1`, [job.id, processed, total]);
    await heartbeat({
      state: "processing", jobId: job.id, scope: job.scope, processed, total, resumed,
      concurrency: validationConcurrency, scheduler: "provider_aware", validationMode,
      providerStartGapMs: validationMode === "supersend" ? 250 : validationProviderStartGapMs,
      providerBackoffMs: validationProviderBackoffMs,
      providerHoldMs: validationProviderHoldMs,
      providerHolds: [...providerHoldUntil.entries()].filter(([, until]) => until > Date.now()).length,
      hardTimeoutMs: validationHardTimeoutMs,
    });
  };

  const outcome = await runProviderAwarePool(
    remaining,
    (contact) => recipientProvider(recipientDomain(contact.normalizedEmail)),
    async (contact) => {
      const provider = recipientProvider(recipientDomain(contact.normalizedEmail));
      let result: ValidationVerdict;

      if (validationMode === "supersend") {
        result = await verifyWithSupersend(contact.normalizedEmail, apiKey as string);
      } else {
        const holdUntil = providerHoldUntil.get(provider) || 0;
        if (holdUntil > Date.now()) {
          return { status: "unknown", detail: "provider_hold_active" };
        }

        result = await validateMailboxWithDeadline(contact.normalizedEmail);

        if (validationIsPreRecipientFailure(result)) {
          providerHoldUntil.set(provider, Date.now() + validationProviderHoldMs);
          return result;
        }

        if (validationMode === "hybrid" && (result.status === "unknown" || result.status === "error")) {
          const fallback = await verifyWithSupersend(contact.normalizedEmail, apiKey as string);
          if (fallback.status === "accepted" || fallback.status === "valid" || fallback.status === "invalid") {
            result = fallback;
          } else {
            result = { status: result.status, detail: `${result.detail};fallback:${fallback.detail}` };
          }
        }
      }

      await db.insert(validationResults).values({ jobId: job.id, contactId: contact.id, email: contact.email, status: result.status, detail: result.detail });
      await db.update(contacts).set({ validationStatus: result.status, updatedAt: new Date() }).where(eq(contacts.id, contact.id));
      if (result.status === "invalid") await addInvalidSuppression(contact.email, contact.id, result.detail);
      processed++;
      await publishProgress(false);
      return result;
    },
    {
      concurrency: job.scope.startsWith("contact:") ? 1 : validationConcurrency,
      lanesForProvider: job.scope.startsWith("contact:")
        ? () => 1
        : validationMode === "supersend"
          ? () => validationConcurrency
          : providerLaneCount,
      providerStartGapMs: job.scope.startsWith("contact:") ? 0 : validationMode === "supersend" ? 250 : validationProviderStartGapMs,
      backoffDelayMs: validationProviderBackoffMs,
      shouldStop: () => validationPaused(),
    },
  );

  await publishProgress(true);
  if (outcome.stopped) {
    await heartbeat({ state: "paused", jobId: job.id, scope: job.scope, processed, total, remaining: Math.max(0, total - processed) });
    return;
  }

  const hasMore = (await contactsForJob(job.scope, job.id, 1)).length > 0;
  if (hasMore) {
    await heartbeat({
      state: "processing", jobId: job.id, scope: job.scope, processed, total, batchComplete: true, resumed,
      providers: outcome.providers, lanes: outcome.lanes, concurrency: outcome.concurrency, validationMode,
      providerHoldMs: validationProviderHoldMs,
      providerHolds: [...providerHoldUntil.entries()].filter(([, until]) => until > Date.now()).length,
    });
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
  console.log(`[validation-worker] started; selectable validation modes; provider-aware concurrency=${validationConcurrency}, provider-start-gap=${validationProviderStartGapMs}ms`);
  while (true) {
    try { await runWithWorkerLock(); }
    catch (error) { console.error("[validation-worker]", error); await heartbeat({ state: "error" }).catch(()=>{}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async()=>{ await pool.end(); process.exit(0); });
