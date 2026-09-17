import { pool } from "@/db";

export class CampaignControlError extends Error {}

export const retryableMessageSql = `accepted_at is null and provider_message_id is null
  and coalesce(last_error,'') not in ('transport_submission_uncertain','transport_state_uncertain_after_worker_restart')`;

export async function controlCampaign(id: string, action: string, connectionPool: Pick<typeof pool, "connect"> = pool) {
  const client = await connectionPool.connect();
  try {
    await client.query("begin");
    const { rows: [campaign] } = await client.query<{ status: string }>("select status from campaigns where id=$1 for update", [id]);
    if (!campaign) throw new CampaignControlError("Campaign not found");
    let status = campaign.status;
    let retried = 0;
    if (action === "cancel") {
      if (["completed", "cancelled"].includes(status)) throw new CampaignControlError("Campaign is already terminal");
      status = "cancelled";
      await client.query("update messages set status='cancelled',last_error='campaign_cancelled',next_attempt_at=null where campaign_id=$1 and status in ('queued','ready_for_transport','deferred')", [id]);
    } else if (action === "pause") {
      if (!["queued", "scheduled", "sending"].includes(status)) throw new CampaignControlError("Only queued, scheduled, or sending campaigns can be paused.");
      status = "paused";
    } else if (action === "resume") {
      if (status !== "paused") throw new CampaignControlError("Campaign is not paused.");
      const { rows: [counts] } = await client.query("select count(*)::int total from messages where campaign_id=$1", [id]);
      status = counts.total > 0 ? "sending" : "queued";
    } else if (action === "retry_failed") {
      if (status === "cancelled") throw new CampaignControlError("Cancelled campaigns cannot be retried.");
      const result = await client.query(`update messages set status='ready_for_transport',last_error=null,next_attempt_at=now(),attempt_count=0 where campaign_id=$1 and status='failed' and ${retryableMessageSql}`, [id]);
      retried = result.rowCount || 0;
      if (!retried) throw new CampaignControlError("No safely retryable messages. Uncertain delivery requires reconciliation.");
      status = campaign.status === "paused" ? "paused" : "sending";
    } else throw new CampaignControlError("Unsupported action");
    await client.query(`update campaigns set status=$2::campaign_status,last_error=null,updated_at=now(),
      cancelled_at=case when $2::text='cancelled' then now() else cancelled_at end,
      completed_at=case when $2::text in ('sending','queued') then null else completed_at end where id=$1`, [id, status]);
    await client.query("commit");
    return { status, retried, previousStatus: campaign.status };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}
