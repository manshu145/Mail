import readline from "node:readline";
import { eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { messageEvents, messages, suppressions } from "../../src/db/schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { normalizeEmail } from "../../src/lib/contact-utils";
import { emitWebhookEvent } from "../../src/lib/webhooks";

async function heartbeat(meta: Record<string, unknown> = {}) {
  await db.insert(workerHeartbeats).values({ workerName: "postfix-events", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } });
}

async function webhook(type: string, payload: Record<string, unknown>) {
  try { await emitWebhookEvent(type, payload); }
  catch (error) { console.error("[postfix-event-webhook]", error); }
}

async function handle(line: string) {
  const queueId = line.match(/postfix\/smtp\[[^\]]+\]:\s+([A-Z0-9]+):/i)?.[1];
  if (!queueId) return false;
  const [message] = await db.select().from(messages).where(eq(messages.providerMessageId, queueId)).limit(1);
  if (!message) return false;
  const status = line.match(/status=(sent|deferred|bounced|expired)/i)?.[1]?.toLowerCase();
  if (!status) return false;
  const dsn = line.match(/dsn=([0-9.]+)/i)?.[1] || null;
  const detail = line.slice(-1000);
  const base = { messageId: message.id, campaignId: message.campaignId, recipientEmail: message.recipientEmail, queueId, dsn };

  if (status === "deferred") {
    await db.update(messages).set({ status: "mta_accepted", lastError: detail }).where(eq(messages.id, message.id));
    await db.insert(messageEvents).values({ messageId: message.id, type: "postfix_deferred", payload: { queueId, dsn, line: detail } });
    await webhook("message.deferred", base);
    return true;
  }

  if (status === "sent") {
    await db.update(messages).set({ status: "delivered", lastError: null, deliveredAt: new Date() }).where(eq(messages.id, message.id));
    await db.insert(messageEvents).values({ messageId: message.id, type: "postfix_delivered", payload: { queueId, dsn, line: detail } });
    await webhook("message.delivered", base);
    return true;
  }

  if (status === "bounced") {
    await db.update(messages).set({ status: "bounced", lastError: detail, bouncedAt: new Date() }).where(eq(messages.id, message.id));
    await db.insert(messageEvents).values({ messageId: message.id, type: "postfix_bounced", payload: { queueId, dsn, line: detail } });
    await db.insert(suppressions).values({ email: message.recipientEmail, normalizedEmail: normalizeEmail(message.recipientEmail), reason: "hard_bounce", source: "postfix_event" }).onConflictDoUpdate({ target: suppressions.normalizedEmail, set: { reason: "hard_bounce", source: "postfix_event" } });
    await webhook("message.bounced", base);
    return true;
  }

  await db.update(messages).set({ status: "failed", lastError: detail }).where(eq(messages.id, message.id));
  await db.insert(messageEvents).values({ messageId: message.id, type: "postfix_expired", payload: { queueId, dsn, line: detail } });
  await webhook("message.failed", base);
  return true;
}

async function main() {
  console.log("[postfix-event-worker] reading Postfix log lines from stdin");
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let processed = 0, matched = 0;
  for await (const line of rl) {
    try { if (await handle(line)) matched++; processed++; if (processed % 25 === 0) await heartbeat({ state: "online", processed, matched }); }
    catch (error) { console.error("[postfix-event-worker]", error); }
  }
  await heartbeat({ state: "stopped", processed, matched });
}

main().catch(console.error).finally(() => pool.end());
