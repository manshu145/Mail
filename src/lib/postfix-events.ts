import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, messageEvents, messages, suppressions, systemSettings } from "@/db/schema";
import { providerCooldowns } from "@/db/operations-schema";
import { providerCooldownEvents } from "@/db/provider-cooldown-event-schema";
import { normalizeEmail } from "@/lib/contact-utils";
import { emitWebhookEvent } from "@/lib/webhooks";
import { classifyBounce } from "@/lib/bounce-classification";
import { classifyDeliveryRestriction, providerForDelivery, SENDER_COOLDOWN_KEY, type DeliveryRestrictionScope } from "@/lib/provider";
import { DELIVERY_SETTING_KEYS, defaultDeliverySettings } from "@/lib/delivery-settings";

const terminalStatuses = new Set(["delivered", "bounced", "failed", "cancelled"]);
export type EventDb = Pick<typeof db, "select" | "insert" | "update">;

async function cooldownMinutes(db: EventDb) {
  const fallback = defaultDeliverySettings().providerCooldownMinutes;
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, DELIVERY_SETTING_KEYS.providerCooldownMinutes)).limit(1);
  const value = Number(row?.value);
  return Number.isFinite(value) ? Math.min(1440, Math.max(1, Math.floor(value))) : fallback;
}

async function sendingAccountForMessage(db: EventDb, campaignId: string) {
  const [campaign] = await db.select({ sendingAccountId: campaigns.sendingAccountId }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  return campaign?.sendingAccountId || null;
}

async function activateProviderCooldown(db: EventDb, params: {
  campaignId: string;
  recipientEmail: string;
  response: string;
  dsn: string | null;
  scope: Exclude<DeliveryRestrictionScope, "none">;
  restrictionReason: string;
}) {
  const sendingAccountId = await sendingAccountForMessage(db, params.campaignId);
  if (!sendingAccountId) return null;
  const provider = params.scope === "sender" ? SENDER_COOLDOWN_KEY : providerForDelivery(params.recipientEmail, params.response);
  const minutes = await cooldownMinutes(db);
  const nextProbeAt = new Date(Date.now() + minutes * 60_000);
  const reason = params.restrictionReason;
  const response = params.response.slice(0, 1000);
  const now = new Date();

  const [cooldown] = await db.insert(providerCooldowns).values({
    sendingAccountId,
    provider,
    active: true,
    reason,
    lastResponse: response,
    detectedAt: now,
    nextProbeAt,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [providerCooldowns.sendingAccountId, providerCooldowns.provider],
    set: {
      active: true,
      reason,
      lastResponse: response,
      detectedAt: now,
      nextProbeAt,
      clearedAt: null,
      updatedAt: now,
    },
  }).returning({ id: providerCooldowns.id });

  if (cooldown) {
    await db.insert(providerCooldownEvents).values({
      cooldownId: cooldown.id,
      sendingAccountId,
      provider,
      eventType: "detected",
      reason,
      response,
      metadata: {
        dsn: params.dsn,
        nextProbeAt: nextProbeAt.toISOString(),
        campaignId: params.campaignId,
        scope: params.scope,
      },
    });
  }

  return { id: cooldown?.id || null, provider, nextProbeAt, sendingAccountId, scope: params.scope };
}

async function cooldownProbeContext(db: EventDb, messageId: string, recipientEmail: string) {
  const [accepted] = await db.select({ payload: messageEvents.payload })
    .from(messageEvents)
    .where(and(eq(messageEvents.messageId, messageId), eq(messageEvents.type, "mta_accepted")))
    .orderBy(desc(messageEvents.createdAt))
    .limit(1);
  const payload = accepted?.payload || {};
  if (payload.providerProbe !== true) return null;

  const scope = payload.cooldownScope === "sender" ? "sender" : "provider";
  const key = typeof payload.cooldownKey === "string" && payload.cooldownKey
    ? payload.cooldownKey
    : scope === "sender"
      ? SENDER_COOLDOWN_KEY
      : typeof payload.provider === "string" && payload.provider
        ? payload.provider
        : providerForDelivery(recipientEmail);

  return { scope, key };
}

async function clearCooldownByKey(db: EventDb, campaignId: string, cooldownKey: string, response: string) {
  const sendingAccountId = await sendingAccountForMessage(db, campaignId);
  if (!sendingAccountId) return false;
  const [cooldown] = await db.select().from(providerCooldowns).where(and(
    eq(providerCooldowns.sendingAccountId, sendingAccountId),
    eq(providerCooldowns.provider, cooldownKey),
    eq(providerCooldowns.active, true),
  )).limit(1);
  if (!cooldown) return false;

  const now = new Date();
  const clipped = response.slice(0, 1000);
  await db.update(providerCooldowns).set({
    active: false,
    lastResponse: clipped,
    clearedAt: now,
    nextProbeAt: null,
    updatedAt: now,
  }).where(eq(providerCooldowns.id, cooldown.id));
  await db.insert(providerCooldownEvents).values({
    cooldownId: cooldown.id,
    sendingAccountId,
    provider: cooldownKey,
    eventType: "cleared_delivery",
    reason: cooldown.reason,
    response: clipped,
    metadata: { campaignId, clearedBy: "successful_probe" },
  });
  return true;
}

export async function handlePostfixEvent(db: EventDb, line: string, mappedMessageId: string | null) {
  const queueId = line.match(/postfix\/smtp\[[^\]]+\]:\s+([A-Z0-9]+):/i)?.[1];
  if (!queueId) return false;
  const [message] = await db.select().from(messages).where(mappedMessageId ? eq(messages.id, mappedMessageId) : eq(messages.providerMessageId, queueId)).limit(1).for("update");
  if (!message || message.status === "sending") return false;
  const status = line.match(/status=(sent|deferred|bounced|expired)/i)?.[1]?.toLowerCase();
  if (!status) return false;

  // The inbox and message are committed together; replay cannot duplicate events.
  if ((status === "sent" && message.status === "delivered") ||
      (status === "bounced" && message.status === "bounced") ||
      (status === "expired" && message.status === "failed")) return true;
  if (status === "deferred" && terminalStatuses.has(message.status)) return true;

  if (status === "sent" && message.status === "bounced") return true;
  if (status === "expired" && ["delivered", "bounced"].includes(message.status)) return true;

  const dsn = line.match(/dsn=([0-9.]+)/i)?.[1] || null;
  const detail = line.slice(-1000);
  const provider = providerForDelivery(message.recipientEmail, detail);
  const base = { messageId: message.id, campaignId: message.campaignId, recipientEmail: message.recipientEmail, queueId, dsn, provider };

  if (status === "deferred") {
    await db.update(messages).set({ status: "mta_accepted", lastError: detail }).where(eq(messages.id, message.id));

    const restriction = classifyDeliveryRestriction(detail, dsn);
    let cooldown: Awaited<ReturnType<typeof activateProviderCooldown>> = null;
    if (restriction.scope !== "none") {
      cooldown = await activateProviderCooldown(db, {
        campaignId: message.campaignId,
        recipientEmail: message.recipientEmail,
        response: detail,
        dsn,
        scope: restriction.scope,
        restrictionReason: restriction.reason,
      });
    }

    await db.insert(messageEvents).values({
      messageId: message.id,
      type: "postfix_deferred",
      payload: {
        queueId,
        dsn,
        provider,
        line: detail,
        restrictionScope: restriction.scope,
        restrictionReason: restriction.reason,
        providerCooldown: Boolean(cooldown),
        cooldownKey: cooldown?.provider,
        nextProbeAt: cooldown?.nextProbeAt?.toISOString(),
      },
    });
    await emitWebhookEvent("message.deferred", {
      ...base,
      restrictionScope: restriction.scope,
      restrictionReason: restriction.reason,
      providerCooldown: Boolean(cooldown),
    }, db);
    return true;
  }

  if (status === "sent") {
    const probe = await cooldownProbeContext(db, message.id, message.recipientEmail);
    if (probe) await clearCooldownByKey(db, message.campaignId, probe.key, detail);

    await db.update(messages).set({ status: "delivered", lastError: null, deliveredAt: new Date() }).where(eq(messages.id, message.id));
    await db.insert(messageEvents).values({
      messageId: message.id,
      type: "postfix_delivered",
      payload: { queueId, dsn, provider, line: detail, cooldownProbe: Boolean(probe), cooldownKey: probe?.key },
    });
    await emitWebhookEvent("message.delivered", { ...base, cooldownProbe: Boolean(probe) }, db);
    return true;
  }

  if (status === "bounced") {
    const classification = classifyBounce(dsn, detail);
    const restriction = classifyDeliveryRestriction(detail, dsn);
    let cooldown: Awaited<ReturnType<typeof activateProviderCooldown>> = null;
    if (restriction.scope !== "none") {
      cooldown = await activateProviderCooldown(db, {
        campaignId: message.campaignId,
        recipientEmail: message.recipientEmail,
        response: detail,
        dsn,
        scope: restriction.scope,
        restrictionReason: restriction.reason,
      });
    }

    await db.update(messages).set({ status: "bounced", lastError: detail, bouncedAt: new Date() }).where(eq(messages.id, message.id));
    await db.insert(messageEvents).values({
      messageId: message.id,
      type: "postfix_bounced",
      payload: {
        queueId,
        dsn,
        provider,
        line: detail,
        bounceKind: classification.kind,
        suppressRecipient: true,
        restrictionScope: restriction.scope,
        restrictionReason: restriction.reason,
        providerCooldown: Boolean(cooldown),
        cooldownKey: cooldown?.provider,
      },
    });

    await db.insert(suppressions).values({
      email: message.recipientEmail,
      normalizedEmail: normalizeEmail(message.recipientEmail),
      reason: classification.suppressRecipient ? "hard_bounce" : "bounce",
      source: "postfix_event",
      note: detail,
    }).onConflictDoNothing({ target: suppressions.normalizedEmail });

    await emitWebhookEvent("message.bounced", {
      ...base,
      bounceKind: classification.kind,
      suppressRecipient: classification.suppressRecipient,
      restrictionScope: restriction.scope,
      restrictionReason: restriction.reason,
      providerCooldown: Boolean(cooldown),
    }, db);
    return true;
  }

  await db.update(messages).set({ status: "failed", lastError: detail }).where(eq(messages.id, message.id));
  await db.insert(messageEvents).values({ messageId: message.id, type: "postfix_expired", payload: { queueId, dsn, provider, line: detail } });
  await emitWebhookEvent("message.failed", base, db);
  return true;
}
