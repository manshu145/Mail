import { and, eq, ilike, lte, ne, notIlike, or } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { auditLogs, campaigns, contactLists, contacts, lists, messages } from "../../src/db/schema";
import { segmentDefinitions } from "../../src/db/segment-schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { getRuntimePolicy } from "../../src/lib/runtime-policy";

const intervalMs = Math.max(1000, Number(process.env.CAMPAIGN_WORKER_INTERVAL_MS || "5000"));

async function heartbeat(meta: Record<string, unknown> = {}) {
  await db.insert(workerHeartbeats).values({ workerName: "campaign", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } });
}

async function resolveRecipients(list: typeof lists.$inferSelect) {
  if (!list.isDynamic) {
    return db.select({ contactId: contacts.id, email: contacts.email }).from(contactLists).innerJoin(contacts, eq(contactLists.contactId, contacts.id)).where(and(eq(contactLists.listId, list.id), eq(contacts.status, "active")));
  }

  const [rule] = await db.select().from(segmentDefinitions).where(eq(segmentDefinitions.listId, list.id)).limit(1);
  if (!rule) return [];

  let condition;
  if (rule.field === "email_domain") {
    condition = rule.operator === "equals" ? ilike(contacts.normalizedEmail, `%@${rule.value}`) : notIlike(contacts.normalizedEmail, `%@${rule.value}`);
  } else if (rule.field === "validation_status") {
    condition = rule.operator === "equals" ? eq(contacts.validationStatus, rule.value as "pending" | "valid" | "invalid" | "unknown" | "error") : ne(contacts.validationStatus, rule.value as "pending" | "valid" | "invalid" | "unknown" | "error");
  } else {
    condition = rule.operator === "equals" ? eq(contacts.status, rule.value as "active" | "archived") : ne(contacts.status, rule.value as "active" | "archived");
  }

  return db.select({ contactId: contacts.id, email: contacts.email }).from(contacts).where(and(eq(contacts.status, "active"), condition));
}

async function blockCampaign(campaignId: string, reason: string, metadata: Record<string, unknown>) {
  await db.transaction(async (tx) => {
    await tx.update(campaigns).set({ status: "paused", updatedAt: new Date() }).where(eq(campaigns.id, campaignId));
    await tx.insert(auditLogs).values({ action: reason, entityType: "campaign", entityId: campaignId, metadataJson: JSON.stringify(metadata) });
  });
}

async function runOnce() {
  const policy = getRuntimePolicy();
  if (!policy.sendingEnabled) {
    await heartbeat({ state: "online", sendingEnabled: false, mode: policy.mode });
    return;
  }

  const now = new Date();
  const due = await db.select().from(campaigns).where(or(eq(campaigns.status, "queued"), and(eq(campaigns.status, "scheduled"), lte(campaigns.scheduledAt, now)))).limit(10);
  let resolved = 0;
  let blocked = 0;

  for (const campaign of due) {
    if (!campaign.listId) { await blockCampaign(campaign.id, "campaign.worker_missing_list", {}); blocked++; continue; }
    const [list] = await db.select().from(lists).where(eq(lists.id, campaign.listId)).limit(1);
    if (!list) { await blockCampaign(campaign.id, "campaign.worker_list_not_found", { listId: campaign.listId }); blocked++; continue; }

    const recipients = await resolveRecipients(list);
    if (policy.maxRecipientsPerCampaign !== null && recipients.length > policy.maxRecipientsPerCampaign) {
      await blockCampaign(campaign.id, "campaign.recipient_limit_blocked", { recipients: recipients.length, limit: policy.maxRecipientsPerCampaign });
      blocked++;
      continue;
    }
    if (!recipients.length) { await blockCampaign(campaign.id, "campaign.worker_empty_audience", { listId: list.id }); blocked++; continue; }

    await db.insert(messages).values(recipients.map((recipient) => ({ campaignId: campaign.id, contactId: recipient.contactId, recipientEmail: recipient.email, status: "queued" as const }))).onConflictDoNothing({ target: [messages.campaignId, messages.contactId] });
    await db.update(campaigns).set({ status: "sending", updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
    resolved += recipients.length;
  }

  await heartbeat({ state: "online", mode: policy.mode, campaigns: due.length, resolved, blocked });
}

async function main() {
  while (true) {
    try { await runOnce(); }
    catch (error) { console.error("[campaign-worker]", error); await heartbeat({ state: "error" }).catch(() => {}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
