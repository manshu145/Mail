import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { campaignPreflights } from "../../src/db/campaign-ops-schema";
import { auditLogs, campaigns, lists, messages, sendingAccounts, templates } from "../../src/db/schema";
import { sendingDomains, workerHeartbeats } from "../../src/db/operations-schema";
import { audienceSelection } from "../../src/lib/audience";
import { preflightAudience } from "../../src/lib/audience-preflight";
import { readDeliverySettings } from "../../src/lib/delivery-settings";
import { getRuntimePolicy } from "../../src/lib/runtime-policy";
import { getCampaignSendGuard } from "../../src/lib/campaign-preflight";
import { listCampaignAttachments } from "../../src/lib/campaign-attachments";
import { listTemplateAttachments } from "../../src/lib/template-attachments";

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

async function claimDueCampaigns(limit: number) {
  if (limit <= 0) return [];
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
  `, [limit]);
  return result.rows.map((row) => row.id);
}

async function runOnce() {
  const recovered = await recoverAbandonedClaims();
  const policy = getRuntimePolicy();
  const delivery = await readDeliverySettings();
  // Publish this worker's current state before running the launch guard. On a
  // fresh deploy the guard must not block itself merely because the previous
  // campaign heartbeat predates the rollout.
  await heartbeat({ state: "online", sendingEnabled: policy.sendingEnabled, mode: policy.mode, recovered, phase: "preflight" });
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
  // maxConcurrentCampaigns is retained only as a backwards-compatible
  // configuration key. A value of 0 means no campaign-count cap. Scheduling
  // fairness and queue backpressure are enforced by claimBatch and the
  // round-robin message claim order, so a held campaign never consumes a
  // permanent customer-visible scheduler slot.
  const activeResult = await pool.query<{ total: number }>(`
    select count(*)::int as total
    from campaigns
    where status='sending'
  `);
  const activeCampaigns = Number(activeResult.rows[0]?.total || 0);
  // Campaign count is not a sending quota. Every due campaign can enter
  // the scheduler; claimBatch is only the per-cycle database backpressure
  // boundary. Held/provider-blocked campaigns therefore do not consume a
  // permanent scheduler slot.
  const schedulerCap = null;
  const availableCampaignSlots = claimBatch;
  const claimedIds = await claimDueCampaigns(claimBatch);
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

      const validationPolicy = campaign.validationPolicy === "previously_validated" || campaign.validationPolicy === "bypass_unvalidated" ? "bypass_unvalidated" : "standard";
      const preflight = await preflightAudience(list, validationPolicy);
      const targetCount = campaign.sendOnlyValidated ? preflight.validCount : preflight.eligibleCount;
      if (!campaign.sendingAccountId || !campaign.templateId) {
        await blockCampaign(campaign.id, "campaign.worker_delivery_configuration_missing", {});
        blocked++;
        continue;
      }
      const [[account], [template]] = await Promise.all([
        db.select().from(sendingAccounts).where(eq(sendingAccounts.id, campaign.sendingAccountId)).limit(1),
        db.select().from(templates).where(eq(templates.id, campaign.templateId)).limit(1),
      ]);
      if (!account || account.status !== "active" || !template) {
        await blockCampaign(campaign.id, "campaign.worker_delivery_configuration_unavailable", {});
        blocked++;
        continue;
      }
      const senderDomain = account.fromEmail.split("@")[1]?.toLowerCase() || "";
      const [[domain], campaignAttachments, templateAttachments] = await Promise.all([
        db.select().from(sendingDomains).where(eq(sendingDomains.domain, senderDomain)).limit(1),
        listCampaignAttachments(campaign.id),
        listTemplateAttachments(template.id),
      ]);
      const sendGuard = await getCampaignSendGuard({
        sendingAccountId: account.id,
        fromEmail: account.fromEmail,
        domain: domain || null,
        audience: preflight,
        subject: campaign.subject || template.subject || "",
        html: template.htmlBody || "",
        text: template.textBody || "",
        attachmentNames: [...campaignAttachments, ...templateAttachments].map((attachment) => attachment.filename),
      });
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
        status: sendGuard.status,
        checks: sendGuard.checks,
        blockingIssues: sendGuard.blockingIssues,
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
          status: sendGuard.status,
          checks: sendGuard.checks,
          blockingIssues: sendGuard.blockingIssues,
          checkedAt: new Date(),
        },
      });

      if (sendGuard.status === "blocked") {
        await blockCampaign(campaign.id, "campaign.preflight_blocked", { checks: sendGuard.checks, blockingIssues: sendGuard.blockingIssues });
        blocked++;
        continue;
      }

      if (campaignLimit !== null && targetCount > campaignLimit) {
        await blockCampaign(campaign.id, "campaign.recipient_limit_blocked", { eligibleRecipients: targetCount, limit: campaignLimit, runtimeLimit, deliveryLimit: delivery.maxRecipientsPerCampaign });
        blocked++;
        continue;
      }
      if (!targetCount) {
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
        const selection = await audienceSelection(list, db, validationPolicy);
        const validationFilter = campaign.sendOnlyValidated ? sql`and validation_status in ('valid','accepted')` : sql``;
        await tx.execute(sql`insert into messages(campaign_id,contact_id,recipient_email,status)
          select ${campaign.id}::uuid, contact_id, email, 'queued'::message_status from (${selection}) audience
          where not suppressed and send_eligible ${validationFilter}
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
            sendOnlyValidated: campaign.sendOnlyValidated,
            validationPolicy: campaign.validationPolicy,
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
      resolved += targetCount;
      excluded += preflight.suppressedCount + preflight.invalidCount;
    } catch (error) {
      console.error(`[campaign-worker] failed campaign ${campaignId}`, error);
      await blockCampaign(campaignId, "campaign.worker_snapshot_failed", {
        error: error instanceof Error ? error.message.slice(0, 500) : "unknown_error",
      }).catch((blockError) => console.error(`[campaign-worker] could not pause failed campaign ${campaignId}`, blockError));
      blocked++;
    }
  }

  await heartbeat({
    state: "online",
    mode: policy.mode,
    claimed: claimedIds.length,
    resolved,
    excluded,
    blocked,
    recovered,
    activeCampaigns,
    maxConcurrentCampaigns: delivery.maxConcurrentCampaigns,
    schedulerCampaignCap: schedulerCap,
    availableCampaignSlots,
    schedulingMode: "round_robin",
    campaignBurstPerRound: delivery.campaignBurstPerRound,
    maxRecipientsPerCampaign: campaignLimit,
    source: "database_control_plane",
  });
}

async function runWithWorkerLock() {
  const lock = await pool.connect();
  let acquired = false;
  try {
    const result = await lock.query<{ acquired: boolean }>("select pg_try_advisory_lock(734201, 2) as acquired");
    acquired = Boolean(result.rows[0]?.acquired);
    if (acquired) await runOnce();
  } finally {
    if (acquired) await lock.query("select pg_advisory_unlock(734201, 2)").catch(() => {});
    lock.release();
  }
}

async function main() {
  await recoverAbandonedClaims();
  while (true) {
    try { await runWithWorkerLock(); }
    catch (error) { console.error("[campaign-worker]", error); await heartbeat({ state: "error" }).catch(() => {}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
