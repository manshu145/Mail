import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { contacts, suppressions, systemSettings, validationJobs, validationResults } from "../../src/db/schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { normalizeEmail } from "../../src/lib/contact-utils";
import { isDirectGmailAddress, type ValidationVerdict } from "../../src/lib/validation-policy";
import { decryptWorkspaceSecret } from "../../src/lib/secure-setting";

const intervalMs = Math.max(15000, Number(process.env.VALIDATION_INTERVAL_MS || "30000"));
const timeoutMs = Math.max(3000, Number(process.env.VALIDATION_API_TIMEOUT_MS || "10000"));
const supersendEndpoint = String(process.env.SUPERSEND_VERIFY_URL || "https://api.supersend.io/v1/verify-email").trim();

type ExistingResult = {
  contact_id: string;
  email: string;
  status: "pending" | "accepted" | "valid" | "invalid" | "unknown" | "error";
  detail: string | null;
};

async function heartbeat(meta: Record<string, unknown> = {}) {
  await db.insert(workerHeartbeats).values({ workerName: "validation", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } });
}

function classifySupersendMessage(message: string): ValidationVerdict {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return { status: "unknown", detail: "supersend_empty_message" };

  if (/(invalid|undeliverable|does not exist|not exist|user unknown|mailbox not found|rejected)/i.test(normalized)) {
    return { status: "invalid", detail: `supersend:${message.slice(0, 300)}` };
  }

  if (/(valid|deliverable|verified|exists|safe to send)/i.test(normalized)) {
    return { status: "valid", detail: `supersend:${message.slice(0, 300)}` };
  }

  return { status: "unknown", detail: `supersend:${message.slice(0, 300)}` };
}

async function configuredSupersendApiKey() {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings)
    .where(eq(systemSettings.key, "validation.supersend_api_key")).limit(1);
  return decryptWorkspaceSecret(row?.value) || String(process.env.SUPERSEND_API_KEY || "").trim() || null;
}

async function verifyWithSupersend(email: string, apiKey: string): Promise<ValidationVerdict> {
  if (!isDirectGmailAddress(email)) return { status: "unknown", detail: "gmail_scope_only" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(supersendEndpoint);
    url.searchParams.set("email", email);
    url.searchParams.set("key", apiKey);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message : "";

    if (!response.ok) {
      return {
        status: response.status >= 500 || response.status === 429 ? "unknown" : "error",
        detail: `supersend_http_${response.status}:${message.slice(0, 240)}`,
      };
    }

    return classifySupersendMessage(message);
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

async function contactsForJob(scope: string) {
  if (scope.startsWith("contact:")) {
    const contactId = scope.slice("contact:".length);
    if (!/^[0-9a-f-]{36}$/i.test(contactId)) return [];
    return db.select().from(contacts).where(and(
      eq(contacts.id, contactId),
      eq(contacts.status, "active"),
      inArray(contacts.validationStatus, ["pending", "unknown", "error"]),
      sql`lower(${contacts.normalizedEmail}) ~ '@(gmail|googlemail)\\.com$'`,
    ));
  }

  if (scope.startsWith("import:")) {
    const importId = scope.slice("import:".length);
    if (!/^[0-9a-f-]{36}$/i.test(importId)) return [];
    const result = await pool.query<{ id: string }>(`
      select distinct c.id
      from import_staging_rows s
      join contacts c on c.id=s.contact_id
      where s.job_id=$1
        and c.status='active'
        and c.validation_status in ('pending','unknown','error')
        and lower(c.normalized_email) ~ '@(gmail|googlemail)\\.com$'
      order by c.id
    `, [importId]);
    const ids = result.rows.map((row) => row.id);
    if (!ids.length) return [];
    return db.select().from(contacts).where(inArray(contacts.id, ids));
  }

  if (scope === "gmail:pending") {
    return db.select().from(contacts).where(and(
      eq(contacts.status, "active"),
      eq(contacts.validationStatus, "pending"),
      sql`lower(${contacts.normalizedEmail}) ~ '@(gmail|googlemail)\\.com$'`,
    ));
  }

  return db.select().from(contacts).where(and(
    eq(contacts.status, "active"),
    inArray(contacts.validationStatus, ["pending", "unknown", "error"]),
    sql`lower(${contacts.normalizedEmail}) ~ '@(gmail|googlemail)\\.com$'`,
  ));
}

async function existingResults(jobId: string) {
  const result = await pool.query<ExistingResult>(`
    select distinct on (contact_id)
      contact_id, email, status::text as status, detail
    from validation_results
    where job_id=$1 and contact_id is not null
    order by contact_id, created_at desc
  `, [jobId]);
  return result.rows;
}

async function addInvalidSuppression(email: string, contactId: string, detail: string | null) {
  await db.insert(suppressions).values({
    email,
    normalizedEmail: normalizeEmail(email),
    contactId,
    reason: "invalid",
    source: "gmail_validation",
    note: detail,
  }).onConflictDoNothing({ target: suppressions.normalizedEmail });
}

async function reconcileExistingResults(rows: ExistingResult[]) {
  for (const row of rows) {
    await db.update(contacts).set({ validationStatus: row.status, updatedAt: new Date() }).where(eq(contacts.id, row.contact_id));
    if (row.status === "invalid") await addInvalidSuppression(row.email, row.contact_id, row.detail);
  }
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
  // A processing job means a previous worker execution was interrupted. Resume it
  // before accepting newer queued work so one stuck job cannot remain forever.
  let [job] = await db.select().from(validationJobs).where(eq(validationJobs.status, "processing")).orderBy(validationJobs.createdAt).limit(1);
  if (job) return job;
  [job] = await db.select().from(validationJobs).where(eq(validationJobs.status, "pending")).orderBy(validationJobs.createdAt).limit(1);
  return job;
}

async function runJob() {
  if (await validationPaused()) {
    await heartbeat({ state: "paused" });
    return;
  }
  const job = await selectWorkJob();
  if (!job) {
    await heartbeat({ state: "idle", provider: "supersend", automaticValidation: false });
    return;
  }

  const apiKey = await configuredSupersendApiKey();
  if (!apiKey) {
    await heartbeat({ state: "waiting_provider_key", provider: "supersend", jobId: job.id, scope: job.scope });
    return;
  }

  const resumed = job.status === "processing";
  if (!resumed) await db.update(validationJobs).set({ status: "processing" }).where(eq(validationJobs.id, job.id));

  const previous = await existingResults(job.id);
  if (previous.length) await reconcileExistingResults(previous);
  const existingIds = new Set(previous.map((row) => row.contact_id));
  const rows = await contactsForJob(job.scope);

  const remaining = rows.filter((contact) => !existingIds.has(contact.id));
  const total = job.scope === "gmail:pending"
    ? existingIds.size + remaining.length
    : Math.max(rows.length, existingIds.size);
  let processed = Math.min(existingIds.size, total);

  await db.update(validationJobs).set({ totalRows: total, processedRows: processed }).where(eq(validationJobs.id, job.id));
  await heartbeat({ state: resumed ? "resumed" : "processing", jobId: job.id, scope: job.scope, processed, total, remaining: remaining.length });

  for (const contact of remaining) {
    if (await validationPaused()) {
      await heartbeat({ state: "paused", jobId: job.id, scope: job.scope, processed, total, remaining: total - processed });
      return;
    }
    const result = await verifyWithSupersend(contact.normalizedEmail, apiKey);
    await db.insert(validationResults).values({ jobId: job.id, contactId: contact.id, email: contact.email, status: result.status, detail: result.detail });
    await db.update(contacts).set({ validationStatus: result.status, updatedAt: new Date() }).where(eq(contacts.id, contact.id));
    if (result.status === "invalid") await addInvalidSuppression(contact.email, contact.id, result.detail);
    processed++;
    await db.update(validationJobs).set({ processedRows: processed }).where(eq(validationJobs.id, job.id));
    await heartbeat({ state: "processing", jobId: job.id, scope: job.scope, processed, total, resumed });
  }

  await db.update(validationJobs).set({ status: "completed", processedRows: total, totalRows: total, completedAt: new Date() }).where(eq(validationJobs.id, job.id));
  await syncImportValidationCounters(job.scope, job.id);
  await heartbeat({ state: "idle", lastJobId: job.id, scope: job.scope, processed: total, resumed });
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
  console.log("[validation-worker] started; optional Gmail validation via Supersend API");
  while (true) {
    try { await runWithWorkerLock(); }
    catch (error) { console.error("[validation-worker]", error); await heartbeat({ state: "error" }).catch(()=>{}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async()=>{ await pool.end(); process.exit(0); });
