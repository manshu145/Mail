import { spawn } from "node:child_process";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { campaigns, contacts, messages, sendingAccounts, templates } from "../../src/db/schema";
import { sendingAccountWarmups, workerHeartbeats } from "../../src/db/operations-schema";
import { signPublicToken } from "../../src/lib/public-tokens";

const sendmailPath = process.env.POSTFIX_SENDMAIL_PATH || "/usr/sbin/sendmail";
const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
const perSecond = Math.max(1, Number(process.env.TRANSPORT_RATE_PER_SECOND || "1"));
const delayMs = Math.ceil(1000 / perSecond);
const intervalMs = Math.max(1000, Number(process.env.TRANSPORT_WORKER_INTERVAL_MS || "3000"));
const maxAttempts = Math.max(1, Number(process.env.TRANSPORT_MAX_ATTEMPTS || "5"));
const claimBatch = Math.min(200, Math.max(1, Number(process.env.TRANSPORT_BATCH_SIZE || "50")));

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function personalize(value: string, contact: typeof contacts.$inferSelect) { return value.replaceAll("{{first_name}}", contact.firstName || "").replaceAll("{{last_name}}", contact.lastName || "").replaceAll("{{email}}", contact.email); }
function headerValue(value: string) { return value.replace(/[\r\n]+/g, " ").trim(); }
function retryDelaySeconds(attempt: number) { return Math.min(3600, Math.max(30, 30 * 2 ** Math.max(0, attempt - 1))); }

async function heartbeat(meta: Record<string, unknown> = {}) { await db.insert(workerHeartbeats).values({ workerName: "transport", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } }); }

async function rewriteLinks(html: string, messageId: string) {
  if (!appUrl) return html;
  let output = html;
  for (const match of [...html.matchAll(/href=(['"])(https?:\/\/[^'\"]+)\1/gi)]) {
    const target = match[2];
    if (target.startsWith(`${appUrl}/unsubscribe/`) || target.startsWith(`${appUrl}/tracking/`)) continue;
    const token = await signPublicToken({ messageId, url: target }, "30d");
    output = output.replace(match[0], `href=${match[1]}${appUrl}/tracking/click/${token}${match[1]}`);
  }
  return output;
}

async function sendRaw(raw: string) {
  return new Promise<{ queueId: string | null }>((resolve, reject) => {
    const child = spawn(sendmailPath, ["-v", "-i", "-t"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(output || `sendmail exited ${code}`));
      resolve({ queueId: output.match(/(?:queued as|queue id[=:]?)[\s]*([A-F0-9]{6,})/i)?.[1] || null });
    });
    child.stdin.end(raw);
  });
}

function warmupLimit(warmup: typeof sendingAccountWarmups.$inferSelect | null, accountDaily: number) {
  if (!warmup?.enabled || !warmup.startedAt) return accountDaily;
  const days = Math.max(0, Math.floor((Date.now() - warmup.startedAt.getTime()) / 86400000));
  const calculated = Math.floor(warmup.dayOneLimit * Math.pow(1 + warmup.growthPercent / 100, days));
  return Math.min(accountDaily, warmup.maxDailyLimit, Math.max(warmup.dayOneLimit, calculated));
}

async function accountWithinLimits(account: typeof sendingAccounts.$inferSelect) {
  const [warmup] = await db.select().from(sendingAccountWarmups).where(eq(sendingAccountWarmups.sendingAccountId, account.id)).limit(1);
  const effectiveDaily = warmupLimit(warmup || null, account.dailyLimit);
  const result = await db.execute(sql`
    select
      count(*) filter(where m.accepted_at >= now() - interval '1 hour')::int as hour_count,
      count(*) filter(where m.accepted_at >= date_trunc('day', now()))::int as day_count
    from messages m
    join campaigns c on c.id = m.campaign_id
    where c.sending_account_id = ${account.id}
  `);
  const row = (result.rows[0] || {}) as Record<string, unknown>;
  return { allowed: Number(row.hour_count || 0) < account.hourlyLimit && Number(row.day_count || 0) < effectiveDaily, effectiveDaily };
}

type Claimed = { id: string; attempt_count: number };
async function claimMessages(): Promise<Claimed[]> {
  const result = await pool.query<Claimed>(
    `with picked as (
       select id from messages
       where status in ('ready_for_transport','deferred')
         and (next_attempt_at is null or next_attempt_at <= now())
       order by queued_at asc
       for update skip locked
       limit $1
     )
     update messages m
     set status='sending',last_attempt_at=now(),attempt_count=m.attempt_count+1,last_error=null
     from picked where m.id=picked.id
     returning m.id,m.attempt_count`, [claimBatch]);
  return result.rows;
}

async function markDeferred(id: string, attempt: number, error: unknown) {
  const detail = error instanceof Error ? error.message.slice(0, 1000) : "sendmail_error";
  if (attempt >= maxAttempts) {
    await pool.query(`update messages set status='failed',last_error=$2,next_attempt_at=null where id=$1 and status='sending'`, [id, detail]);
    return "failed" as const;
  }
  const delaySeconds = retryDelaySeconds(attempt);
  await pool.query(`update messages set status='deferred',last_error=$2,next_attempt_at=now()+($3::int * interval '1 second') where id=$1 and status='sending'`, [id, detail, delaySeconds]);
  return "deferred" as const;
}

async function releaseThrottled(id: string) {
  await pool.query(`update messages set status='ready_for_transport',next_attempt_at=now()+interval '60 seconds',last_error='sending_account_rate_limited' where id=$1 and status='sending'`, [id]);
}

async function recoverStaleClaims() {
  await pool.query(`update messages set status='failed',next_attempt_at=null,last_error='transport_state_uncertain_after_worker_restart' where status='sending' and accepted_at is null and last_attempt_at is not null and last_attempt_at < now()-interval '10 minutes'`);
}

async function runOnce() {
  if (!appUrl) throw new Error("APP_URL is required");
  const claimed = await claimMessages();
  let accepted = 0, deferred = 0, failed = 0, throttled = 0;

  for (const claim of claimed) {
    const [message] = await db.select().from(messages).where(eq(messages.id, claim.id)).limit(1);
    if (!message) continue;
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, message.campaignId)).limit(1);
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, message.contactId)).limit(1);
    if (!campaign || !contact || !campaign.sendingAccountId || !campaign.templateId || campaign.status === "cancelled") {
      await pool.query(`update messages set status='failed',last_error='campaign_transport_configuration_incomplete',next_attempt_at=null where id=$1 and status='sending'`, [message.id]);
      failed++; continue;
    }

    const [account] = await db.select().from(sendingAccounts).where(eq(sendingAccounts.id, campaign.sendingAccountId)).limit(1);
    const [template] = await db.select().from(templates).where(eq(templates.id, campaign.templateId)).limit(1);
    if (!account || account.status !== "active" || !template) {
      await pool.query(`update messages set status='failed',last_error='sending_account_or_template_unavailable',next_attempt_at=null where id=$1 and status='sending'`, [message.id]);
      failed++; continue;
    }

    const limit = await accountWithinLimits(account);
    if (!limit.allowed) { await releaseThrottled(message.id); throttled++; continue; }

    const unsubscribeToken = await signPublicToken({ email: contact.email, messageId: message.id }, "90d");
    const unsubscribeUrl = `${appUrl}/unsubscribe/${unsubscribeToken}`;
    let html = personalize(template.htmlBody, contact).replaceAll("{{unsubscribe_url}}", unsubscribeUrl);
    const text = personalize(template.textBody, contact).replaceAll("{{unsubscribe_url}}", unsubscribeUrl);
    if (campaign.trackClicks) html = await rewriteLinks(html, message.id);
    if (campaign.trackOpens) { const token = await signPublicToken({ messageId: message.id }, "30d"); html += `<img src="${appUrl}/tracking/open/${token}" width="1" height="1" alt="" style="display:none!important" />`; }

    const subject = headerValue(personalize(campaign.subject || template.subject || "", contact));
    const fromName = headerValue(campaign.fromName || account.fromName);
    const fromEmail = headerValue(campaign.fromEmail || account.fromEmail);
    const replyTo = headerValue(account.replyTo || account.fromEmail);
    const recipient = headerValue(contact.email);
    const boundary = `neximail_${message.id.replaceAll("-", "")}`;
    const raw = [
      `From: ${fromName} <${fromEmail}>`, `To: ${recipient}`, `Reply-To: ${replyTo}`, `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${message.id}@${fromEmail.split("@")[1] || "neximail.local"}>`, `X-NexiMail-Message-ID: ${message.id}`, "MIME-Version: 1.0",
      `List-Unsubscribe: <${unsubscribeUrl}>`, "List-Unsubscribe-Post: List-Unsubscribe=One-Click", `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
      `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", text || "This message has an HTML version.", "",
      `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", html, "", `--${boundary}--`, "",
    ].join("\r\n");

    try {
      const result = await sendRaw(raw);
      await pool.query(`update messages set status='mta_accepted',accepted_at=now(),provider_message_id=$2,last_error=null,next_attempt_at=null where id=$1 and status='sending'`, [message.id, result.queueId]);
      accepted++;
    } catch (error) {
      const state = await markDeferred(message.id, claim.attempt_count, error);
      if (state === "deferred") deferred++; else failed++;
    }
    await sleep(delayMs);
  }

  // Campaign completion is intentionally owned by event-worker. A message that is
  // merely mta_accepted is still awaiting a remote delivery/bounce/failure result.
  await heartbeat({ state: "online", claimed: claimed.length, accepted, deferred, failed, throttled, perSecond, maxAttempts });
}

async function main() {
  if (!appUrl) throw new Error("APP_URL is required");
  await recoverStaleClaims();
  while (true) {
    try { await runOnce(); }
    catch (error) { console.error("[transport-worker]", error); await heartbeat({ state: "error" }).catch(() => {}); }
    await sleep(intervalMs);
  }
}

main().catch(console.error);
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
