import { eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { auditLogs, campaigns, lists, messages } from "../../src/db/schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { resolveAudienceRecipients } from "../../src/lib/audience";
import { getRuntimePolicy } from "../../src/lib/runtime-policy";

const intervalMs = Math.max(1000, Number(process.env.CAMPAIGN_WORKER_INTERVAL_MS || "5000"));
const claimBatch = Math.max(1, Math.min(25, Number(process.env.CAMPAIGN_CLAIM_BATCH || "5")));

async function heartbeat(meta: Record<string, unknown> = {}) {
  await db.insert(workerHeartbeats).values({ workerName: "campaign", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } });
}

async function blockCampaign(campaignId: string, reason: string, metadata: Record<string, unknown>) {
  await db.transaction(async (tx) => {
    await tx.update(campaigns).set({ status: "paused", lastError: reason, updatedAt: new Date() }).where(eq(campaigns.id, campaignId));
    await tx.insert(auditLogs).values({ action: reason, entityType: "campaign", entityId: campaignId, metadataJson: JSON.stringify(metadata) });
  });
}

async function recoverAbandonedClaims() {
  await pool.query(`
    update campaigns
    set status='paused', last_error='campaign_worker_interrupted_before_audience_snapshot', updated_at=now()
    where status='sending'
      and coalesce(message_count,0)=0
      and started_at is not null
      and started_at < now() - interval '10 minutes'
  `);
}

async function claimDueCampaigns() {
  const result = await pool.query<{ id: string }>(`
    with due as (
      select id
      from campaigns
      where status='queued'
         or (status='scheduled' and scheduled_at is not null and scheduled_at <= now())
      order by coalesce(scheduled_at, created_at) asc
      for update skip locked
      limit $1
    )
    update campaigns c
    set status='sending', started_at=coalesce(c.started_at,now()), last_error=null, updated_at=now()
    from due
    where c.id=due.id
    returning c.id::text
  `, [claimBatch]);
  return result.rows.map((row) => row.id);
}

async function runOnce() {
  const policy = getRuntimePolicy();
  if (!policy.sendingEnabled) {
    await heartbeat({ state: "online", sendingEnabled: false, mode: policy.mode });
    return;
  }

  const claimedIds = await claimDueCampaigns();
  let resolved = 0;
  let blocked = 0;

  for (const campaignId of claimedIds) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    if (!campaign) continue;
    if (!campaign.listId) { await blockCampaign(campaign.id, "campaign.worker_missing_list", {}); blocked++; continue; }
    const [list] = await db.select().from(lists).where(eq(lists.id, campaign.listId)).limit(1);
    if (!list) { await blockCampaign(campaign.id, "campaign.worker_list_not_found", { listId: campaign.listId }); blocked++; continue; }

    const recipients = await resolveAudienceRecipients(list);
    if (policy.maxRecipientsPerCampaign !== null && recipients.length > policy.maxRecipientsPerCampaign) {
      await blockCampaign(campaign.id, "campaign.recipient_limit_blocked", { recipients: recipients.length, limit: policy.maxRecipientsPerCampaign });
      blocked++;
      continue;
    }
    if (!recipients.length) { await blockCampaign(campaign.id, "campaign.worker_empty_audience", { listId: list.id }); blocked++; continue; }

    await db.transaction(async (tx) => {
      await tx.insert(messages).values(recipients.map((recipient) => ({ campaignId: campaign.id, contactId: recipient.contactId, recipientEmail: recipient.email, status: "queued" as const }))).onConflictDoNothing({ target: [messages.campaignId, messages.contactId] });
      const [counts] = await tx.select({ count: sql<number>`count(*)::int` }).from(messages).where(eq(messages.campaignId, campaign.id));
      await tx.update(campaigns).set({ audienceCount: recipients.length, messageCount: Number(counts?.count || 0), lastError: null, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
      await tx.insert(auditLogs).values({ action: "campaign.audience_snapshotted", entityType: "campaign", entityId: campaign.id, metadataJson: JSON.stringify({ audienceCount: recipients.length, messageCount: Number(counts?.count || 0), listId: list.id }) });
    });
    resolved += recipients.length;
  }

  await heartbeat({ state: "online", mode: policy.mode, claimed: claimedIds.length, resolved, blocked });
}

async function main() {
  await recoverAbandonedClaims();
  while (true) {
    try { await runOnce(); }
    catch (error) { console.error("[campaign-worker]", error); await heartbeat({ state: "error" }).catch(() => {}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
