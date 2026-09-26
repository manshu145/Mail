import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { contacts, lists, suppressions, systemSettings, validationJobs, validationResults } from "../../src/db/schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { normalizeEmail } from "../../src/lib/contact-utils";
import { validationAudienceSelection } from "../../src/lib/audience";
import type { ValidationVerdict } from "../../src/lib/validation-policy";
import { validateMailboxInternally } from "../../src/lib/mailbox-validator";
import { recipientDomain, recipientProvider, runProviderAwarePool, validationIsPreRecipientFailure, validationNeedsBackoff } from "../../src/lib/validation-throughput";
import { decryptWorkspaceSecret } from "../../src/lib/secure-setting";
import { normalizeValidationMode, validationModeNeedsSupersend, type ValidationMode } from "../../src/lib/validation-provider";
import { verifyWithSupersend } from "../../src/lib/supersend-validation";

const intervalMs = Math.max(2000, Number(process.env.VALIDATION_INTERVAL_MS || "5000"));
const timeoutMs = Math.max(3000, Number(process.env.VALIDATION_API_TIMEOUT_MS || "10000"));
const validationHardTimeoutMs = Math.max(timeoutMs, Math.min(120_000, Number(process.env.VALIDATION_HARD_TIMEOUT_MS || "45000")));
const validationEvidenceTtlMs = Math.max(
  5 * 60_000,
  Math.min(90 * 24 * 60 * 60_000, Number(process.env.VALIDATION_EVIDENCE_TTL_MS || String(30 * 24 * 60 * 60_000))),
);
const validationRetryCooldownMs = Math.max(
  60_000,
  Math.min(24 * 60 * 60_000, Number(process.env.VALIDATION_RETRY_COOLDOWN_MS || String(15 * 60_000))),
);
const jobRetryUntil = new Map<string, number>();

async function validateMailboxWithDeadline(email: string): Promise<ValidationVerdict> {
  return Promise.race([
    validateMailboxInternally(email),
    new Promise<ValidationVerdict>((resolve) => setTimeout(
      () => resolve({ status: "unknown", detail: "smtp_validation_hard_timeout" }),
      validationHardTimeoutMs,
    )),
  ]);
}


type ExistingResult = {
  contact_id: string;
  email: string;
  status: "pending" | "accepted" | "valid" | "invalid" | "unknown" | "error";
  detail: string | null;
};

async function heartbeat(meta: Record<string, unknown> = {}) {
  await db.insert(workerHeartbeats).values({ workerName: "validation", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } });
}

async function configuredSupersendApiKey() {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings)
    .where(eq(systemSettings.key, "validation.supersend_api_key")).limit(1);
  return decryptWorkspaceSecret(row?.value) || String(process.env.SUPERSEND_API_KEY || "").trim() || null;
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
const validationConcurrency = Math.max(1, Math.min(32, Number(process.env.VALIDATION_CONCURRENCY || "20")));
const validationTargetPerSecond = Math.max(1, Math.min(10, Number(process.env.VALIDATION_TARGET_PER_SECOND || "5")));
const validationBasePerSecond = Math.max(1, Math.min(validationTargetPerSecond, Number(process.env.VALIDATION_BASE_PER_SECOND || "1")));
const configuredProviderStartGapMs = Number(process.env.VALIDATION_PROVIDER_START_GAP_MS || "0");
const validationProviderStartGapMs = configuredProviderStartGapMs > 0
  ? Math.max(100, Math.min(10_000, configuredProviderStartGapMs))
  : 0;
const validationGlobalStartGapMs = Math.max(100, Math.ceil(1000 / validationTargetPerSecond));
const defaultAdaptiveGapMs = Math.max(100, Math.ceil(1000 / validationBasePerSecond));
const validationProviderBackoffMs = Math.max(defaultAdaptiveGapMs, Math.min(120_000, Number(process.env.VALIDATION_PROVIDER_BACKOFF_MS || "15000")));
const validationProviderHoldMs = Math.max(validationProviderBackoffMs, Math.min(3_600_000, Number(process.env.VALIDATION_PROVIDER_HOLD_MS || "600000")));
const validationProviderHoldFloorMs = Math.max(60_000, validationProviderBackoffMs * 4);
const providerHoldUntil = new Map<string, number>();
const providerRatePerSecond = new Map<string, number>();
const providerSuccessStreak = new Map<string, number>();
const providerFailureLevel = new Map<string, number>();
const providerHoldReason = new Map<string, string>();
const providerLastPressureAt = new Map<string, string>();

// SuperSend is an optional enhancement in Smart Hybrid. Keep authentication
// failures behind a circuit breaker so one missing/expired customer key cannot
// turn into one API request per inconclusive recipient.
const supersendCircuitCooldownMs = Math.max(
  5 * 60_000,
  Math.min(24 * 60 * 60_000, Number(process.env.SUPERSEND_AUTH_COOLDOWN_MS || String(24 * 60 * 60_000))),
);
let supersendCircuitOpenUntil = 0;
let supersendCircuitKey: string | null = null;
let supersendCircuitReason = "";
let supersendCredentialProbe: Promise<ValidationVerdict> | null = null;
let supersendCredentialProbeKey: string | null = null;

function supersendCircuitAvailable(apiKey: string | null) {
  if (!apiKey) return false;
  if (supersendCircuitKey !== apiKey) {
    supersendCircuitKey = apiKey;
    supersendCircuitOpenUntil = 0;
    supersendCircuitReason = "";
    supersendCredentialProbe = null;
    supersendCredentialProbeKey = apiKey;
  }
  return supersendCircuitOpenUntil <= Date.now();
}

function isSupersendAuthFailure(result: ValidationVerdict) {
  const detail = String(result.detail || "");
  return detail.startsWith("supersend_http_401") || detail.startsWith("supersend_http_403");
}

function openSupersendCircuit(apiKey: string, detail: string) {
  supersendCircuitKey = apiKey;
  supersendCircuitOpenUntil = Date.now() + supersendCircuitCooldownMs;
  supersendCircuitReason = detail;
  console.warn("[validation-worker] SuperSend authentication circuit opened for " + supersendCircuitCooldownMs + "ms detail=" + detail);
}

async function verifySupersendSafely(email: string, apiKey: string): Promise<ValidationVerdict> {
  if (!supersendCircuitAvailable(apiKey)) {
    return { status: "unknown", detail: "supersend_circuit_open" };
  }

  if (supersendCredentialProbeKey !== apiKey) {
    supersendCredentialProbeKey = apiKey;
    supersendCredentialProbe = null;
  }

  if (supersendCredentialProbe) {
    const probe = await supersendCredentialProbe;
    if (isSupersendAuthFailure(probe) || !supersendCircuitAvailable(apiKey)) {
      return { status: "unknown" as const, detail: "supersend_circuit_open" };
    }
  }

  if (!supersendCredentialProbe) {
    const probe = verifyWithSupersend(email, apiKey)
      .then((result) => {
        if (isSupersendAuthFailure(result)) {
          openSupersendCircuit(apiKey, result.detail);
          return { status: "unknown" as const, detail: result.detail + ";supersend_circuit_open" };
        }
        return result;
      })
      .finally(() => {
        supersendCredentialProbe = null;
      });
    supersendCredentialProbe = probe;
    return probe;
  }

  const result = await verifyWithSupersend(email, apiKey);
  if (isSupersendAuthFailure(result)) {
    openSupersendCircuit(apiKey, result.detail);
    return { status: "unknown", detail: result.detail + ";supersend_circuit_open" };
  }
  return result;
}

function currentProviderRate(provider: string) {
  return providerRatePerSecond.get(provider) || validationBasePerSecond;
}

function providerStartGapFor(provider: string) {
  if (validationProviderStartGapMs > 0) return validationProviderStartGapMs;
  return Math.max(100, Math.ceil(1000 / Math.max(1, currentProviderRate(provider))));
}

function registerProviderPressure(provider: string, verdict: ValidationVerdict) {
  const currentRate = currentProviderRate(provider);
  providerRatePerSecond.set(provider, Math.max(1, Math.floor(currentRate / 2)));
  providerSuccessStreak.set(provider, 0);
  const level = Math.min(5, (providerFailureLevel.get(provider) || 0) + 1);
  providerFailureLevel.set(provider, level);
  // A pre-recipient SMTP banner/connection rejection is a provider-level
  // condition, not a mailbox-level verdict. Defer that provider for the
  // remainder of the current validation day so the job keeps moving through
  // other providers instead of retrying the same blocked MX every 60-600s.
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(18, 30, 0, 0); // 00:00 Asia/Kolkata
  if (tomorrow.getTime() <= now.getTime()) tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const holdMs = Math.max(
    validationProviderHoldFloorMs,
    tomorrow.getTime() - now.getTime(),
  );
  const until = tomorrow.getTime();
  providerHoldUntil.set(provider, until);
  providerHoldReason.set(provider, String(verdict.detail || verdict.status || "unknown"));
  providerLastPressureAt.set(provider, new Date().toISOString());
  console.warn(`[validation-worker] provider hold provider=${provider} level=${level} rate=${currentProviderRate(provider)}/s holdMs=${holdMs} detail=${String(verdict.detail || verdict.status || "unknown")}`);
}

function registerProviderOutcome(provider: string, verdict: ValidationVerdict) {
  if (validationNeedsBackoff(verdict)) {
    providerRatePerSecond.set(provider, Math.max(1, currentProviderRate(provider) - 1));
    providerSuccessStreak.set(provider, 0);
    return;
  }
  const nextStreak = (providerSuccessStreak.get(provider) || 0) + 1;
  if (nextStreak >= 25) {
    providerRatePerSecond.set(provider, Math.min(validationTargetPerSecond, currentProviderRate(provider) + 1));
    providerSuccessStreak.set(provider, 0);
    if ((providerFailureLevel.get(provider) || 0) > 0) {
      providerFailureLevel.set(provider, Math.max(0, (providerFailureLevel.get(provider) || 0) - 1));
    }
  } else {
    providerSuccessStreak.set(provider, nextStreak);
  }
}

function providerLaneCount(provider: string) {
  if (provider === "google") return Math.max(1, Math.min(8, Number(process.env.VALIDATION_GOOGLE_LANES || "6")));
  if (provider === "yahoo") return Math.max(1, Math.min(6, Number(process.env.VALIDATION_YAHOO_LANES || "4")));
  if (provider === "microsoft") return Math.max(1, Math.min(6, Number(process.env.VALIDATION_MICROSOFT_LANES || "4")));
  if (provider === "rediff") return Math.max(1, Math.min(4, Number(process.env.VALIDATION_REDIFF_LANES || "3")));
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
        and not exists(select 1 from validation_results vr where vr.job_id=$2 and vr.contact_id=c.id and vr.status in ('accepted','valid','invalid','unknown'))
      limit $3
    `, [contactId, jobId, limit]);
    return result.rows;
  }

  if (scope.startsWith("list:")) {
    const listId = scope.slice("list:".length);
    if (!/^[0-9a-f-]{36}$/i.test(listId)) return [];
    const [list] = await db.select().from(lists).where(eq(lists.id, listId)).limit(1);
    if (!list) return [];
    const audience = await validationAudienceSelection(list);
    const result = await db.execute(sql`
      select a.contact_id::text as id,a.email,a.normalized_email as "normalizedEmail"
      from (${audience}) a
      where a.validation_status in ('pending','unknown','error')
        and not exists(select 1 from validation_results vr where vr.job_id=${jobId} and vr.contact_id=a.contact_id and vr.status in ('accepted','valid','invalid','unknown'))
      order by a.contact_id
      limit ${limit}
    `);
    return result.rows as ValidationContact[];
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
            and vr.status in ('accepted','valid','invalid')
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
        and not exists(select 1 from validation_results vr where vr.job_id=$1 and vr.contact_id=c.id and vr.status in ('accepted','valid','invalid','unknown'))
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
      and not exists(select 1 from validation_results vr where vr.job_id=$1 and vr.contact_id=c.id and vr.status in ('accepted','valid','invalid','unknown'))
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
      and status in ('accepted','valid','invalid','unknown')
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
        and not exists(select 1 from validation_results vr where vr.job_id=$2 and vr.contact_id=c.id and vr.status in ('accepted','valid','invalid','unknown'))
    `, [contactId, jobId]);
    return Number(result.rows[0]?.total || 0);
  }

  if (scope.startsWith("list:")) {
    const listId = scope.slice("list:".length);
    if (!/^[0-9a-f-]{36}$/i.test(listId)) return 0;
    const [list] = await db.select().from(lists).where(eq(lists.id, listId)).limit(1);
    if (!list) return 0;
    const audience = await validationAudienceSelection(list);
    const result = await db.execute(sql`
      select count(*)::int as total
      from (${audience}) a
      where a.validation_status in ('pending','unknown','error')
        and not exists(select 1 from validation_results vr where vr.job_id=${jobId} and vr.contact_id=a.contact_id and vr.status in ('accepted','valid','invalid','unknown'))
    `);
    return Number((result.rows[0] as { total?: number } | undefined)?.total || 0);
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
        and not exists(select 1 from validation_results vr where vr.job_id=$2 and vr.contact_id=c.id and vr.status in ('accepted','valid','invalid','unknown'))
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
        and not exists(select 1 from validation_results vr where vr.job_id=$1 and vr.contact_id=c.id and vr.status in ('accepted','valid','invalid','unknown'))
    `, [jobId]);
    return Number(result.rows[0]?.total || 0);
  }

  const result = await pool.query<{ total: number }>(`
    select count(*)::int as total
    from contacts c
    where c.status='active'
      and c.validation_status in ('pending','unknown','error')
      and not exists(select 1 from validation_results vr where vr.job_id=$1 and vr.contact_id=c.id and vr.status in ('accepted','valid','invalid','unknown'))
  `, [jobId]);
  return Number(result.rows[0]?.total || 0);
}
async function applyHistoricalRecipientEvidence(email: string, verdict: ValidationVerdict): Promise<ValidationVerdict> {
  if (verdict.status !== "unknown") return verdict;
  const normalized = normalizeEmail(email);
  const result = await pool.query<{
    delivered: boolean;
    hardFailure: boolean;
    cachedStatus: "accepted" | "valid" | "invalid" | null;
    cachedDetail: string | null;
  }>(`
    select
      exists(
        select 1 from messages m
        where lower(m.recipient_email)=lower($1)
          and m.status='delivered'
      ) as delivered,
      exists(
        select 1 from suppressions s
        where s.normalized_email=$1
          and s.reason in ('hard_bounce','invalid')
      ) as "hardFailure",
      (
        select vr.status::text
        from validation_results vr
        where lower(vr.email)=lower($1)
          and vr.status in ('accepted','valid','invalid')
          and vr.created_at > now() - ($2 * interval '1 millisecond')
        order by vr.created_at desc
        limit 1
      ) as "cachedStatus",
      (
        select vr.detail
        from validation_results vr
        where lower(vr.email)=lower($1)
          and vr.status in ('accepted','valid','invalid')
          and vr.created_at > now() - ($2 * interval '1 millisecond')
        order by vr.created_at desc
        limit 1
      ) as "cachedDetail"
  `, [normalized, validationEvidenceTtlMs]);
  const row = result.rows[0];
  if (row?.hardFailure) return { status: "invalid", detail: "historical_hard_failure" };
  if (row?.delivered) return { status: "valid", detail: "historical_successful_delivery" };
  if (row?.cachedStatus === "accepted" || row?.cachedStatus === "valid") {
    return { status: "valid", detail: "validation_cache_hit:" + String(row.cachedDetail || "valid") };
  }
  if (row?.cachedStatus === "invalid") {
    return { status: "invalid", detail: "validation_cache_hit:" + String(row.cachedDetail || "invalid") };
  }
  return verdict;
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

async function validationDailyLimit() {
  const [row] = await db.select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, "reputation.validation_daily_limit"))
    .limit(1);
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5000;
}

async function validationDailyUsage() {
  const result = await pool.query<{ total: number }>(`
    select count(*)::int as total
    from validation_results
    where created_at >= (
      date_trunc('day', timezone('Asia/Kolkata', now()))
      at time zone 'Asia/Kolkata'
    )
  `);
  return Number(result.rows[0]?.total || 0);
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

  const retryUntil = jobRetryUntil.get(job.id) || 0;
  if (retryUntil > Date.now()) {
    await heartbeat({ state: "retry_wait", jobId: job.id, scope: job.scope, retryAt: new Date(retryUntil).toISOString(), retryCooldownMs: validationRetryCooldownMs });
    return;
  }
  jobRetryUntil.delete(job.id);

  const dailyLimit = await validationDailyLimit();
  const dailyUsage = await validationDailyUsage();
  const dailyRemaining = Math.max(0, dailyLimit - dailyUsage);
  if (dailyRemaining <= 0) {
    await heartbeat({ state: "daily_quota_exhausted", jobId: job.id, scope: job.scope, dailyLimit, dailyUsage });
    return;
  }

  const validationMode = normalizeValidationMode(job.validationMode);
  const apiKey = validationModeNeedsSupersend(validationMode) ? await configuredSupersendApiKey() : null;

  // Explicit SuperSend mode requires a credential. Smart Hybrid does not:
  // internal validation remains fully usable when no external provider is configured.
  if (validationMode === "supersend" && !apiKey) {
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
  const remaining = await contactsForJob(job.scope, job.id, Math.min(validationBatchSize, dailyRemaining));
  let dailyCompleted = 0;
  const total = Math.max(Number(job.totalRows || 0), processed + remainingCount);

  await db.update(validationJobs).set({ totalRows: total, processedRows: processed }).where(eq(validationJobs.id, job.id));
  await heartbeat({
    state: resumed ? "resumed" : "processing", jobId: job.id, scope: job.scope, processed, total,
    batch: remaining.length, concurrency: validationConcurrency, scheduler: "provider_aware",
    validationMode,
    targetPerSecond: validationMode === "supersend" ? null : validationTargetPerSecond,
    basePerSecond: validationMode === "supersend" ? null : validationBasePerSecond,
    providerStartGapMs: validationMode === "supersend" ? 250 : validationProviderStartGapMs,
    providerRates: validationMode === "supersend" ? {} : Object.fromEntries(providerRatePerSecond),
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
      targetPerSecond: validationMode === "supersend" ? null : validationTargetPerSecond,
      basePerSecond: validationMode === "supersend" ? null : validationBasePerSecond,
      providerStartGapMs: validationMode === "supersend" ? 250 : validationProviderStartGapMs,
      globalStartGapMs: validationMode === "supersend" ? 250 : validationGlobalStartGapMs,
      providerRates: validationMode === "supersend" ? {} : Object.fromEntries(providerRatePerSecond),
      providerBackoffMs: validationProviderBackoffMs,
      providerHoldMs: validationProviderHoldMs,
      providerHolds: [...providerHoldUntil.entries()].filter(([, until]) => until > Date.now()).length,
      providerHoldReasons: Object.fromEntries([...providerHoldReason.entries()].filter(([provider]) => (providerHoldUntil.get(provider) || 0) > Date.now())),
      providerLastPressureAt: Object.fromEntries([...providerLastPressureAt.entries()].filter(([provider]) => (providerHoldUntil.get(provider) || 0) > Date.now())),
      hardTimeoutMs: validationHardTimeoutMs,
      supersendConfigured: Boolean(apiKey),
      supersendCircuitOpen: Boolean(apiKey && !supersendCircuitAvailable(apiKey)),
      supersendCircuitOpenUntil: supersendCircuitOpenUntil > Date.now() ? new Date(supersendCircuitOpenUntil).toISOString() : null,
      supersendCircuitReason: supersendCircuitReason || null,
    });
  };

  const outcome = await runProviderAwarePool(
    remaining,
    (contact) => recipientProvider(recipientDomain(contact.normalizedEmail)),
    async (contact) => {
      const provider = recipientProvider(recipientDomain(contact.normalizedEmail));
      let result: ValidationVerdict;

      // Layer 1: exact-email cache + delivery/suppression history.
      result = await applyHistoricalRecipientEvidence(contact.normalizedEmail, {
        status: "unknown",
        detail: "validation_cache_miss",
      });

      if (result.status === "unknown" || result.status === "error") {
        if (validationMode === "supersend") {
          result = await verifySupersendSafely(contact.normalizedEmail, apiKey as string);
        } else {
          const holdUntil = providerHoldUntil.get(provider) || 0;
          if (holdUntil > Date.now()) {
            result = { status: "unknown", detail: "provider_hold_active" };
          } else {
            // Layer 2: NexiMail internal syntax + DNS/MX safety check.
            result = await validateMailboxWithDeadline(contact.normalizedEmail);
            // MX-positive addresses are treated as sendable by default. Internal
            // validation cannot prove mailbox existence without an external
            // mailbox-verification provider, so do not leave ordinary MX-positive
            // recipients in an endless "unknown" bucket. Hard DNS/MX failures
            // remain invalid/unknown and continue through the normal safeguards.
            if (result.status === "unknown" && result.detail === "mx_present_mailbox_unverified") {
              result = { status: "valid", detail: "mx_present_sendable" };
            }
            if (validationIsPreRecipientFailure(result)) {
              registerProviderPressure(provider, result);
            } else {
              registerProviderOutcome(provider, result);
            }
          }

          // Layer 3: Smart Hybrid optionally falls back to SuperSend.
          // No key means no external call; the internal result remains unknown.
          if (
            validationMode === "hybrid" &&
            apiKey &&
            supersendCircuitAvailable(apiKey) &&
            (result.status === "unknown" || result.status === "error")
          ) {
            const fallback = await verifySupersendSafely(contact.normalizedEmail, apiKey);
            if (fallback.status === "accepted" || fallback.status === "valid" || fallback.status === "invalid") {
              result = fallback;
            } else {
              result = { status: result.status, detail: result.detail + ";fallback:" + fallback.detail };
            }
          }
        }
      }

      const finalized = result.status === "accepted" || result.status === "valid" || result.status === "invalid" || result.status === "unknown";
      await db.insert(validationResults).values({ jobId: job.id, contactId: contact.id, email: contact.email, status: result.status, detail: result.detail });
      await db.update(contacts).set({ validationStatus: result.status, updatedAt: new Date() }).where(eq(contacts.id, contact.id));
      if (result.status === "invalid") await addInvalidSuppression(contact.email, contact.id, result.detail);

      // Unknown is a terminal "risky/unverified" result when no external
      // provider can establish mailbox-level validity. Do not retry it forever.
      if (!finalized) {
        jobRetryUntil.set(job.id, Date.now() + validationRetryCooldownMs);
      } else {
        processed++;
      }
      dailyCompleted++;
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
      providerStartGapMs: job.scope.startsWith("contact:") ? 0 : validationMode === "supersend" ? 250 : (provider) => providerStartGapFor(provider),
      globalStartGapMs: job.scope.startsWith("contact:") ? 0 : validationMode === "supersend" ? 250 : validationGlobalStartGapMs,
      backoffDelayMs: validationProviderBackoffMs,
      shouldHoldProvider: (verdict) => validationIsPreRecipientFailure(verdict),
      providerHoldUntil: (provider) => providerHoldUntil.get(provider) || 0,
      shouldStop: async () => {
        if (await validationPaused()) return true;
        if (dailyCompleted >= dailyRemaining) return true;
        const [currentJob] = await db.select({ status: validationJobs.status }).from(validationJobs)
          .where(eq(validationJobs.id, job.id)).limit(1);
        return currentJob?.status === "cancelled";
      },
    },
  );

  await publishProgress(true);
  const [jobAfterPool] = await db.select({ status: validationJobs.status }).from(validationJobs)
    .where(eq(validationJobs.id, job.id)).limit(1);
  if (jobAfterPool?.status === "cancelled") {
    await heartbeat({
      state: "cancelled",
      jobId: job.id,
      scope: job.scope,
      processed,
      total,
      remaining: Math.max(0, total - processed),
    });
    return;
  }
  if (outcome.stopped) {
    const quotaReached = dailyCompleted >= dailyRemaining;
    await heartbeat({ state: quotaReached ? "daily_quota_exhausted" : "paused", jobId: job.id, scope: job.scope, processed, total, remaining: Math.max(0, total - processed), dailyLimit, dailyUsage: dailyUsage + dailyCompleted });
    return;
  }

  const hasMore = (await contactsForJob(job.scope, job.id, 1)).length > 0;
  if (hasMore) {
    const activeHolds = [...providerHoldUntil.entries()].filter(([, until]) => until > Date.now());
    const allProvidersHeld = outcome.providers > 0 && outcome.heldProviders.length >= outcome.providers && activeHolds.length >= outcome.providers;
    const nextResumeAt = activeHolds.length ? new Date(Math.min(...activeHolds.map(([, until]) => until))).toISOString() : null;
    await heartbeat({
      state: allProvidersHeld ? "provider_hold" : "processing", jobId: job.id, scope: job.scope, processed, total, batchComplete: true, resumed,
      providers: outcome.providers, lanes: outcome.lanes, concurrency: outcome.concurrency, validationMode,
      heldProviders: outcome.heldProviders,
      providerHoldMs: validationProviderHoldMs,
      providerHolds: activeHolds.length,
      nextResumeAt,
      targetPerSecond: validationMode === "supersend" ? null : validationTargetPerSecond,
      basePerSecond: validationMode === "supersend" ? null : validationBasePerSecond,
      providerRates: validationMode === "supersend" ? {} : Object.fromEntries(providerRatePerSecond),
      providerHoldReasons: Object.fromEntries([...providerHoldReason.entries()].filter(([provider]) => (providerHoldUntil.get(provider) || 0) > Date.now())),
      providerLastPressureAt: Object.fromEntries([...providerLastPressureAt.entries()].filter(([provider]) => (providerHoldUntil.get(provider) || 0) > Date.now())),
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
  console.log(`[validation-worker] started; selectable validation modes; provider-aware concurrency=${validationConcurrency}, global-cap=${validationTargetPerSecond}/s, provider-ramp=${validationBasePerSecond}->${validationTargetPerSecond}/s, provider-start-gap=${validationProviderStartGapMs || "adaptive"}`);
  while (true) {
    try { await runWithWorkerLock(); }
    catch (error) { console.error("[validation-worker]", error); await heartbeat({ state: "error" }).catch(()=>{}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async()=>{ await pool.end(); process.exit(0); });
