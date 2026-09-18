import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { campaignPreflights } from "../../src/db/campaign-ops-schema";
import { auditLogs, campaigns, lists, messages } from "../../src/db/schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { audienceSelection } from "../../src/lib/audience";
import { preflightAudience } from "../../src/lib/audience-preflight";
import { readDeliverySettings } from "../../src/lib/delivery-settings";
import { getRuntimePolicy } from "../../src/lib/runtime-policy";

const intervalMs = Math.max(1000, Number(process.env.CAMPAIGN_WORKER_INTERVAL_MS || "5000"));
const claimBatch = Math.max(1, Math.min(25, Number(process.env.CAMPAIGN_CLAIM_BATCH || "5")));

async function heartbeat(meta: Record<string, unknown> = {}) {
  await db.insert(workerHeartbeats).values({ workerName: "campaign", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } });
}

async function blockCampaign(campaignId: string, reason: string, metadata: Record<string, unknown>) {
  await db.transaction(async (tx) => {
    await tx.update(campaigns).set({ status: "paused", lastError: reason, updatedAt: new Date() }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "sending")));
    await tx.insert(auditLogs).values({ action: reason, entityType: "campaign", entityId: campaignId, metadataJson: JSON.stringify(metadata) });
  });
}

async function recoverAbandonedClaims() {
  const result = await pool.query<{ id: string }>(`
    update campaigns
    set status='paused', last_error='campaign_worker_interrupted_before_audience_snapshot', updated_at=now()
    where status='sending'
      and coalesce(message_count,0)=0
      and started_at is not null
      and updated_at < now() - interval '10 minutes'
    returning id::text
  `);
  return result.rowCount || 0;
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
  const recovered = await recoverAbandonedClaims();
  const policy = getRuntimePolicy();
  const delivery = await readDeliverySettings();
  if (!policy.sendingEnabled) {
    await heartbeat({ state: "online", sendingEnabled: false, mode: policy.mode, maxRecipientsPerCampaign: delivery.maxRecipientsPerCampaign, recovered });
    return;
  }

  const runtimeLimit = policy.maxRecipientsPerCampaign;
  const deliveryLimit = delivery.maxRecipientsPerCampaign > 0 ? delivery.maxRecipientsPerCampaign : null;
  const campaignLimit =
    runtimeLimit === null ? deliveryLimit :
    deliveryLimit === null ? runtimeLimit :
    Math.min(runtimeLimit, deliveryLimit);
  const claimedIds = await claimDueCampaigns();
  let resolved = 0;
  let excluded = 0;
  let blocked = 0;

  for (const campaignId of claimedIds) {
    try {
      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
      if (!campaign) continue;
      if (!campaign.listId) { await blockCampaign(campaign.id, "campaign.worker_missing_list", {}); blocked++; continue; }
      const [list] = await db.select().from(lists).where(eq(lists.id, campaign.listId)).limit(1);
      if (!list) { await blockCampaign(campaign.id, "campaign.worker_list_not_found", { listId: campaign.listId }); blocked++; continue; }

      const preflight = await preflightAudience(list);
      await db.insert(campaignPreflights).values({
        campaignId: campaign.id,
        listId: list.id,
        rawCount: preflight.rawCount,
        eligibleCount: preflight.eligibleCount,
        suppressedCount: preflight.suppressedCount,
        invalidCount: preflight.invalidCount,
        validCount: preflight.validCount,
        pendingCount: preflight.pendingCount,
        unknownCount: preflight.unknownCount,
        checkedAt: new Date(),
      }).onConflictDoUpdate({
        target: campaignPreflights.campaignId,
        set: {
          listId: list.id,
          rawCount: preflight.rawCount,
          eligibleCount: preflight.eligibleCount,
          suppressedCount: preflight.suppressedCount,
          invalidCount: preflight.invalidCount,
          validCount: preflight.validCount,
          pendingCount: preflight.pendingCount,
          unknownCount: preflight.unknownCount,
          checkedAt: new Date(),
        },
      });

      if (campaignLimit !== null && preflight.eligibleCount > campaignLimit) {
        await blockCampaign(campaign.id, "campaign.recipient_limit_blocked", { eligibleRecipients: preflight.eligibleCount, limit: campaignLimit, runtimeLimit, deliveryLimit: delivery.maxRecipientsPerCampaign });
        blocked++;
        continue;
      }
      if (!preflight.eligibleCount) {
        await blockCampaign(campaign.id, "campaign.worker_no_eligible_recipients", {
          rawCount: preflight.rawCount,
          suppressedCount: preflight.suppressedCount,
          invalidCount: preflight.invalidCount,
        });
        blocked++;
        continue;
      }

      await db.transaction(async (tx) => {
        const [current] = await tx.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, campaign.id)).for("update");
        if (current?.status !== "sending") return;
        const selection = await audienceSelection(list);
        await tx.execute(sql`insert into messages(campaign_id,contact_id,recipient_email,status)
          select ${campaign.id}::uuid, contact_id, email, 'queued'::message_status from (${selection}) audience
          where not suppressed and send_eligible
          on conflict(campaign_id,contact_id) do nothing`);
        const [counts] = await tx.select({ count: sql<number>`count(*)::int` }).from(messages).where(eq(messages.campaignId, campaign.id));
        if (!Number(counts?.count || 0)) throw new Error("No eligible recipients remain at snapshot time");
        if (campaignLimit !== null && Number(counts?.count || 0) > campaignLimit) throw new Error("Audience grew beyond campaign limit during snapshot");
        await tx.update(campaigns).set({ audienceCount: Number(counts?.count || 0), messageCount: Number(counts?.count || 0), lastError: null, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
        await tx.insert(auditLogs).values({
          action: "campaign.audience_snapshotted",
          entityType: "campaign",
          entityId: campaign.id,
          metadataJson: JSON.stringify({
            listId: list.id,
            rawCount: preflight.rawCount,
            eligibleCount: preflight.eligibleCount,
            suppressedCount: preflight.suppressedCount,
            invalidCount: preflight.invalidCount,
            validCount: preflight.validCount,
            pendingCount: preflight.pendingCount,
            unknownCount: preflight.unknownCount,
            messageCount: Number(counts?.count || 0),
            campaignLimit,
          }),
        });
      });
      resolved += preflight.eligibleCount;
      excluded += preflight.suppressedCount + preflight.invalidCount;
    } catch (error) {
      console.error(`[campaign-worker] failed campaign ${campaignId}`, error);
      await blockCampaign(campaignId, "campaign.worker_snapshot_failed", {
        error: error instanceof Error ? error.message.slice(0, 500) : "unknown_error",
      }).catch((blockError) => console.error(`[campaign-worker] could not pause failed campaign ${campaignId}`, blockError));
      blocked++;
    }
  }

  await heartbeat({ state: "online", mode: policy.mode, claimed: claimedIds.length, resolved, excluded, blocked, recovered, maxRecipientsPerCampaign: campaignLimit, source: "database_control_plane" });
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
