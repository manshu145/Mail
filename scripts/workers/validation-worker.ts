import net from "node:net";
import { resolveMx } from "node:dns/promises";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { contacts, suppressions, systemSettings, validationJobs, validationResults } from "../../src/db/schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { normalizeEmail } from "../../src/lib/contact-utils";
import { classifyGmailRcptResponse, type ValidationVerdict } from "../../src/lib/validation-policy";

const intervalMs = Math.max(15000, Number(process.env.VALIDATION_INTERVAL_MS || "30000"));
const timeoutMs = Math.max(3000, Number(process.env.VALIDATION_SMTP_TIMEOUT_MS || "8000"));
const helo = process.env.VALIDATION_HELO || "validator.local";

type ExistingResult = {
  contact_id: string;
  email: string;
  status: "pending" | "accepted" | "valid" | "invalid" | "unknown" | "error";
  detail: string | null;
};

async function heartbeat(meta: Record<string, unknown> = {}) {
  await db.insert(workerHeartbeats).values({ workerName: "validation", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } });
}

async function smtpProbe(email: string): Promise<ValidationVerdict> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || !["gmail.com", "googlemail.com"].includes(domain)) return { status: "unknown", detail: "gmail_scope_only" };
  let mx;
  try { mx = (await resolveMx(domain)).sort((a,b)=>a.priority-b.priority)[0]; } catch { return { status: "error", detail: "mx_lookup_failed" }; }
  if (!mx) return { status: "error", detail: "mx_not_found" };

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: mx.exchange, port: 25 });
    let buffer = ""; let stage = 0; let settled = false;
    const finish = (value: ValidationVerdict) => { if (settled) return; settled = true; socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => finish({ status: "unknown", detail: "smtp_timeout" }));
    socket.on("error", () => finish({ status: "unknown", detail: "smtp_unreachable" }));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || "";
      for (const line of lines) {
        if (!/^\d{3}[ -]/.test(line) || /^\d{3}-/.test(line)) continue;
        const code = Number(line.slice(0,3));
        if (stage === 0 && code === 220) { stage=1; socket.write(`EHLO ${helo}\r\n`); continue; }
        if (stage === 1 && code >= 200 && code < 400) { stage=2; socket.write("MAIL FROM:<>\r\n"); continue; }
        if (stage === 2 && code >= 200 && code < 400) { stage=3; socket.write(`RCPT TO:<${email}>\r\n`); continue; }
        if (stage === 3) return finish(classifyGmailRcptResponse(code, line));
        if (code >= 400) return finish({ status: "unknown", detail: `smtp_${code}` });
      }
    });
  });
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
      sql`lower(${contacts.normalizedEmail}) ~ '@(gmail|googlemail)\\.com

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

async function queuePendingGmailIfNeeded() {
  const active = await pool.query<{ count: number }>(`select count(*)::int count from validation_jobs where status in ('pending','processing')`);
  if (Number(active.rows[0]?.count || 0) > 0) return false;
  const pending = await pool.query<{ count: number }>(`
    select count(*)::int count from contacts
    where status='active' and validation_status='pending'
      and lower(normalized_email) ~ '@(gmail|googlemail)\\.com$'
  `);
  const count = Number(pending.rows[0]?.count || 0);
  if (!count) return false;
  await db.insert(validationJobs).values({ scope: "gmail:pending", totalRows: count });
  await heartbeat({ state: "auto_queued", scope: "gmail:pending", total: count });
  return true;
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
  let job = await selectWorkJob();
  if (!job) {
    const queued = await queuePendingGmailIfNeeded();
    if (!queued) { await heartbeat({ state: "idle" }); return; }
    job = await selectWorkJob();
    if (!job) return;
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
    const result = await smtpProbe(contact.normalizedEmail);
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
  console.log("[validation-worker] started; restart-safe Gmail validation with automatic pending sweep");
  while (true) {
    try { await runWithWorkerLock(); }
    catch (error) { console.error("[validation-worker]", error); await heartbeat({ state: "error" }).catch(()=>{}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async()=>{ await pool.end(); process.exit(0); });
`,
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
        and lower(c.normalized_email) ~ '@(gmail|googlemail)\\.com

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

async function queuePendingGmailIfNeeded() {
  const active = await pool.query<{ count: number }>(`select count(*)::int count from validation_jobs where status in ('pending','processing')`);
  if (Number(active.rows[0]?.count || 0) > 0) return false;
  const pending = await pool.query<{ count: number }>(`
    select count(*)::int count from contacts
    where status='active' and validation_status='pending'
      and lower(normalized_email) ~ '@(gmail|googlemail)\\.com$'
  `);
  const count = Number(pending.rows[0]?.count || 0);
  if (!count) return false;
  await db.insert(validationJobs).values({ scope: "gmail:pending", totalRows: count });
  await heartbeat({ state: "auto_queued", scope: "gmail:pending", total: count });
  return true;
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
  let job = await selectWorkJob();
  if (!job) {
    const queued = await queuePendingGmailIfNeeded();
    if (!queued) { await heartbeat({ state: "idle" }); return; }
    job = await selectWorkJob();
    if (!job) return;
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
    const result = await smtpProbe(contact.normalizedEmail);
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
  console.log("[validation-worker] started; restart-safe Gmail validation with automatic pending sweep");
  while (true) {
    try { await runWithWorkerLock(); }
    catch (error) { console.error("[validation-worker]", error); await heartbeat({ state: "error" }).catch(()=>{}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async()=>{ await pool.end(); process.exit(0); });

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
      sql`lower(${contacts.normalizedEmail}) ~ '@(gmail|googlemail)\\.com

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

async function queuePendingGmailIfNeeded() {
  const active = await pool.query<{ count: number }>(`select count(*)::int count from validation_jobs where status in ('pending','processing')`);
  if (Number(active.rows[0]?.count || 0) > 0) return false;
  const pending = await pool.query<{ count: number }>(`
    select count(*)::int count from contacts
    where status='active' and validation_status='pending'
      and lower(normalized_email) ~ '@(gmail|googlemail)\\.com$'
  `);
  const count = Number(pending.rows[0]?.count || 0);
  if (!count) return false;
  await db.insert(validationJobs).values({ scope: "gmail:pending", totalRows: count });
  await heartbeat({ state: "auto_queued", scope: "gmail:pending", total: count });
  return true;
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
  let job = await selectWorkJob();
  if (!job) {
    const queued = await queuePendingGmailIfNeeded();
    if (!queued) { await heartbeat({ state: "idle" }); return; }
    job = await selectWorkJob();
    if (!job) return;
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
    const result = await smtpProbe(contact.normalizedEmail);
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
  console.log("[validation-worker] started; restart-safe Gmail validation with automatic pending sweep");
  while (true) {
    try { await runWithWorkerLock(); }
    catch (error) { console.error("[validation-worker]", error); await heartbeat({ state: "error" }).catch(()=>{}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async()=>{ await pool.end(); process.exit(0); });
`,
    ));
  }
  return db.select().from(contacts).where(and(
    eq(contacts.status, "active"),
    inArray(contacts.validationStatus, ["pending", "unknown", "error"]),
    sql`lower(${contacts.normalizedEmail}) ~ '@(gmail|googlemail)\\.com

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

async function queuePendingGmailIfNeeded() {
  const active = await pool.query<{ count: number }>(`select count(*)::int count from validation_jobs where status in ('pending','processing')`);
  if (Number(active.rows[0]?.count || 0) > 0) return false;
  const pending = await pool.query<{ count: number }>(`
    select count(*)::int count from contacts
    where status='active' and validation_status='pending'
      and lower(normalized_email) ~ '@(gmail|googlemail)\\.com$'
  `);
  const count = Number(pending.rows[0]?.count || 0);
  if (!count) return false;
  await db.insert(validationJobs).values({ scope: "gmail:pending", totalRows: count });
  await heartbeat({ state: "auto_queued", scope: "gmail:pending", total: count });
  return true;
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
  let job = await selectWorkJob();
  if (!job) {
    const queued = await queuePendingGmailIfNeeded();
    if (!queued) { await heartbeat({ state: "idle" }); return; }
    job = await selectWorkJob();
    if (!job) return;
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
    const result = await smtpProbe(contact.normalizedEmail);
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
  console.log("[validation-worker] started; restart-safe Gmail validation with automatic pending sweep");
  while (true) {
    try { await runWithWorkerLock(); }
    catch (error) { console.error("[validation-worker]", error); await heartbeat({ state: "error" }).catch(()=>{}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async()=>{ await pool.end(); process.exit(0); });
`,
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

async function queuePendingGmailIfNeeded() {
  const active = await pool.query<{ count: number }>(`select count(*)::int count from validation_jobs where status in ('pending','processing')`);
  if (Number(active.rows[0]?.count || 0) > 0) return false;
  const pending = await pool.query<{ count: number }>(`
    select count(*)::int count from contacts
    where status='active' and validation_status='pending'
      and lower(normalized_email) ~ '@(gmail|googlemail)\\.com$'
  `);
  const count = Number(pending.rows[0]?.count || 0);
  if (!count) return false;
  await db.insert(validationJobs).values({ scope: "gmail:pending", totalRows: count });
  await heartbeat({ state: "auto_queued", scope: "gmail:pending", total: count });
  return true;
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
  let job = await selectWorkJob();
  if (!job) {
    const queued = await queuePendingGmailIfNeeded();
    if (!queued) { await heartbeat({ state: "idle" }); return; }
    job = await selectWorkJob();
    if (!job) return;
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
    const result = await smtpProbe(contact.normalizedEmail);
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
  console.log("[validation-worker] started; restart-safe Gmail validation with automatic pending sweep");
  while (true) {
    try { await runWithWorkerLock(); }
    catch (error) { console.error("[validation-worker]", error); await heartbeat({ state: "error" }).catch(()=>{}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async()=>{ await pool.end(); process.exit(0); });
