import readline from "node:readline";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { campaigns, messageEvents, messages, suppressions } from "../../src/db/schema";
import { providerCooldowns, workerHeartbeats } from "../../src/db/operations-schema";
import { providerCooldownEvents } from "../../src/db/provider-cooldown-event-schema";
import { normalizeEmail } from "../../src/lib/contact-utils";
import { emitWebhookEvent } from "../../src/lib/webhooks";
import { classifyBounce } from "../../src/lib/bounce-classification";
import { isProviderPressureResponse, providerForDelivery } from "../../src/lib/provider";

const providerCooldownMinutes = Math.max(1, Number(process.env.PROVIDER_COOLDOWN_MINUTES || "15"));

async function heartbeat(meta: Record<string, unknown> = {}) {
  await db.insert(workerHeartbeats).values({ workerName: "postfix-events", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } });
}

async function webhook(type: string, payload: Record<string, unknown>) {
  try { await emitWebhookEvent(type, payload); }
  catch (error) { console.error("[postfix-event-webhook]", error); }
}

async function sendingAccountForMessage(campaignId: string) {
  const [campaign] = await db.select({ sendingAccountId: campaigns.sendingAccountId }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  return campaign?.sendingAccountId || null;
}

async function activateProviderCooldown(params: { campaignId: string; recipientEmail: string; response: string; dsn: string | null }) {
  const sendingAccountId = await sendingAccountForMessage(params.campaignId);
  if (!sendingAccountId) return null;
  const provider = providerForDelivery(params.recipientEmail, params.response);
  const nextProbeAt = new Date(Date.now() + providerCooldownMinutes * 60_000);
  const reason = params.dsn ? `SMTP ${params.dsn}` : "provider_pressure";
  const response = params.response.slice(0, 1000);
  const now = new Date();
  const [cooldown] = await db.insert(providerCooldowns).values({ sendingAccountId, provider, active: true, reason, lastResponse: response, detectedAt: now, nextProbeAt, updatedAt: now })
    .onConflictDoUpdate({ target: [providerCooldowns.sendingAccountId, providerCooldowns.provider], set: { active: true, reason, lastResponse: response, detectedAt: now, nextProbeAt, clearedAt: null, updatedAt: now } })
    .returning({ id: providerCooldowns.id });
  if (cooldown) await db.insert(providerCooldownEvents).values({ cooldownId: cooldown.id, sendingAccountId, provider, eventType: "detected", reason, response, metadata: { dsn: params.dsn, nextProbeAt: nextProbeAt.toISOString(), campaignId: params.campaignId } });
  return { id: cooldown?.id || null, provider, nextProbeAt, sendingAccountId };
}

async function clearProviderCooldown(campaignId: string, recipientEmail: string, response: string) {
  const sendingAccountId = await sendingAccountForMessage(campaignId);
  if (!sendingAccountId) return;
  const provider = providerForDelivery(recipientEmail, response);
  const [cooldown] = await db.select().from(providerCooldowns).where(and(eq(providerCooldowns.sendingAccountId, sendingAccountId), eq(providerCooldowns.provider, provider), eq(providerCooldowns.active, true))).limit(1);
  if (!cooldown) return;
  const now = new Date();
  const clipped = response.slice(0, 1000);
  await db.update(providerCooldowns).set({ active: false, lastResponse: clipped, clearedAt: now, nextProbeAt: null, updatedAt: now }).where(eq(providerCooldowns.id, cooldown.id));
  await db.insert(providerCooldownEvents).values({ cooldownId: cooldown.id, sendingAccountId, provider, eventType: "cleared_delivery", reason: cooldown.reason, response: clipped, metadata: { campaignId } });
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
  const provider = providerForDelivery(message.recipientEmail, detail);
  const base = { messageId: message.id, campaignId: message.campaignId, recipientEmail: message.recipientEmail, queueId, dsn, provider };

  if (status === "deferred") {
    await db.update(messages).set({ status: "mta_accepted", lastError: detail }).where(eq(messages.id, message.id));
    let cooldown: Awaited<ReturnType<typeof activateProviderCooldown>> = null;
    if (isProviderPressureResponse(detail, dsn)) cooldown = await activateProviderCooldown({ campaignId: message.campaignId, recipientEmail: message.recipientEmail, response: detail, dsn });
    await db.insert(messageEvents).values({ messageId: message.id, type: "postfix_deferred", payload: { queueId, dsn, provider, line: detail, providerCooldown: Boolean(cooldown), nextProbeAt: cooldown?.nextProbeAt?.toISOString() } });
    await webhook("message.deferred", { ...base, providerCooldown: Boolean(cooldown) });
    return true;
  }

  if (status === "sent") {
    await clearProviderCooldown(message.campaignId, message.recipientEmail, detail);
    await db.update(messages).set({ status: "delivered", lastError: null, deliveredAt: new Date() }).where(eq(messages.id, message.id));
    await db.insert(messageEvents).values({ messageId: message.id, type: "postfix_delivered", payload: { queueId, dsn, provider, line: detail } });
    await webhook("message.delivered", base);
    return true;
  }

  if (status === "bounced") {
    const classification = classifyBounce(dsn, detail);
    let cooldown: Awaited<ReturnType<typeof activateProviderCooldown>> = null;
    if (classification.providerPressure) {
      cooldown = await activateProviderCooldown({ campaignId: message.campaignId, recipientEmail: message.recipientEmail, response: detail, dsn });
    }

    await db.update(messages).set({ status: "bounced", lastError: detail, bouncedAt: new Date() }).where(eq(messages.id, message.id));
    await db.insert(messageEvents).values({ messageId: message.id, type: "postfix_bounced", payload: { queueId, dsn, provider, line: detail, bounceKind: classification.kind, suppressRecipient: classification.suppressRecipient, providerCooldown: Boolean(cooldown) } });

    if (classification.suppressRecipient) {
      await db.insert(suppressions).values({ email: message.recipientEmail, normalizedEmail: normalizeEmail(message.recipientEmail), reason: "hard_bounce", source: "postfix_event", note: detail }).onConflictDoUpdate({ target: suppressions.normalizedEmail, set: { reason: "hard_bounce", source: "postfix_event", note: detail } });
    }

    await webhook("message.bounced", { ...base, bounceKind: classification.kind, suppressRecipient: classification.suppressRecipient, providerCooldown: Boolean(cooldown) });
    return true;
  }

  await db.update(messages).set({ status: "failed", lastError: detail }).where(eq(messages.id, message.id));
  await db.insert(messageEvents).values({ messageId: message.id, type: "postfix_expired", payload: { queueId, dsn, provider, line: detail } });
  await webhook("message.failed", base);
  return true;
}

async function main() {
  console.log("[postfix-event-worker] reading Postfix log lines from stdin");
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let processed = 0, matched = 0;
  for await (const line of rl) {
    try { if (await handle(line)) matched++; processed++; if (processed % 25 === 0) await heartbeat({ state: "online", processed, matched, providerCooldownMinutes }); }
    catch (error) { console.error("[postfix-event-worker]", error); }
  }
  await heartbeat({ state: "stopped", processed, matched, providerCooldownMinutes });
}

main().catch(console.error).finally(() => pool.end());
