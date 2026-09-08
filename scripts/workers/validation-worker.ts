import net from "node:net";
import { resolveMx } from "node:dns/promises";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { contacts, suppressions, validationJobs, validationResults } from "../../src/db/schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { normalizeEmail } from "../../src/lib/contact-utils";

const intervalMs = Math.max(15000, Number(process.env.VALIDATION_INTERVAL_MS || "30000"));
const timeoutMs = Math.max(3000, Number(process.env.VALIDATION_SMTP_TIMEOUT_MS || "8000"));
const helo = process.env.VALIDATION_HELO || "validator.local";

async function heartbeat(meta: Record<string, unknown> = {}) {
  await db.insert(workerHeartbeats).values({ workerName: "validation", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } });
}

async function smtpProbe(email: string): Promise<{ status: "valid" | "invalid" | "unknown" | "error"; detail: string }> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || !["gmail.com", "googlemail.com"].includes(domain)) return { status: "unknown", detail: "gmail_scope_only" };
  let mx;
  try { mx = (await resolveMx(domain)).sort((a,b)=>a.priority-b.priority)[0]; } catch { return { status: "error", detail: "mx_lookup_failed" }; }
  if (!mx) return { status: "error", detail: "mx_not_found" };

  return new Promise((resolve) => {
    const socket = net.createConnection({ host: mx.exchange, port: 25 });
    let buffer = ""; let stage = 0; let settled = false;
    const finish = (value: { status: "valid" | "invalid" | "unknown" | "error"; detail: string }) => { if (settled) return; settled = true; socket.destroy(); resolve(value); };
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
        if (stage === 3) {
          if (code === 250 || code === 251) return finish({ status: "valid", detail: `gmail_rcpt_${code}` });
          if (code === 550 && /5\.1\.1|user unknown|no such user|does not exist/i.test(line)) return finish({ status: "invalid", detail: "gmail_rcpt_550_5.1.1" });
          return finish({ status: "unknown", detail: `gmail_rcpt_${code || "ambiguous"}` });
        }
        if (code >= 400) return finish({ status: "unknown", detail: `smtp_${code}` });
      }
    });
  });
}

async function runJob() {
  const [job] = await db.select().from(validationJobs).where(eq(validationJobs.status, "pending")).limit(1);
  if (!job) { await heartbeat({ state: "idle" }); return; }
  await db.update(validationJobs).set({ status: "processing" }).where(eq(validationJobs.id, job.id));
  const rows = await db.select().from(contacts).where(and(eq(contacts.status, "active"), sql`lower(${contacts.normalizedEmail}) like '%@gmail.com'`));
  let processed = 0;
  for (const contact of rows) {
    const result = await smtpProbe(contact.normalizedEmail);
    await db.insert(validationResults).values({ jobId: job.id, contactId: contact.id, email: contact.email, status: result.status, detail: result.detail });
    await db.update(contacts).set({ validationStatus: result.status, updatedAt: new Date() }).where(eq(contacts.id, contact.id));
    if (result.status === "invalid") {
      await db.insert(suppressions).values({ email: contact.email, normalizedEmail: normalizeEmail(contact.email), contactId: contact.id, reason: "invalid", source: "gmail_validation", note: result.detail }).onConflictDoNothing({ target: suppressions.normalizedEmail });
    }
    processed++;
    await db.update(validationJobs).set({ processedRows: processed }).where(eq(validationJobs.id, job.id));
    await heartbeat({ state: "processing", jobId: job.id, processed, total: rows.length });
  }
  await db.update(validationJobs).set({ status: "completed", processedRows: processed, totalRows: rows.length, completedAt: new Date() }).where(eq(validationJobs.id, job.id));
  await heartbeat({ state: "idle", lastJobId: job.id, processed });
}

async function main() {
  console.log("[validation-worker] started; unknown is never upgraded to valid");
  while (true) { try { await runJob(); } catch (error) { console.error("[validation-worker]", error); await heartbeat({ state: "error" }).catch(()=>{}); } await new Promise(r=>setTimeout(r, intervalMs)); }
}
main().catch(console.error);
process.on("SIGTERM", async()=>{ await pool.end(); process.exit(0); });
