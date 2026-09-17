import { eq, sql } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { campaigns } from "../../src/db/schema";
import { workerHeartbeats } from "../../src/db/operations-schema";
import { emitWebhookEvent } from "../../src/lib/webhooks";

const intervalMs = Math.max(3000, Number(process.env.EVENT_WORKER_INTERVAL_MS || "10000"));
async function heartbeat(meta: Record<string, unknown> = {}) { await db.insert(workerHeartbeats).values({ workerName: "event", metadata: meta }).onConflictDoUpdate({ target: workerHeartbeats.workerName, set: { lastSeenAt: new Date(), metadata: meta } }); }

async function run() {
  const active = await db.select().from(campaigns).where(eq(campaigns.status, "sending"));
  let completed = 0;
  for (const campaign of active) {
    const result = await db.transaction(async tx => {
      const [current] = await tx.select().from(campaigns).where(eq(campaigns.id, campaign.id)).for("update");
      if (current?.status !== "sending") return false;
      // Read after taking the same campaign lock used by retries and controls.
      const counts = await tx.execute(sql`select count(*)::int total,
        count(*) filter(where status in ('queued','ready_for_transport','sending','mta_accepted','deferred'))::int active
        from messages where campaign_id=${campaign.id}`);
      const row = counts.rows[0];
      if (!Number(row?.total) || Number(row?.active)) return false;
      const now = new Date();
      await tx.update(campaigns).set({ status: "completed", completedAt: now, messageCount: Number(row.total), lastError: null, updatedAt: now }).where(eq(campaigns.id, campaign.id));
      await emitWebhookEvent("campaign.completed", { campaignId: campaign.id, name: campaign.name, messageCount: Number(row.total), completedAt: now.toISOString() }, tx);
      return true;
    });
    if (result) completed++;

  }
  await heartbeat({ state: "online", campaigns: active.length, completed });
}

async function main() {
  while (true) {
    try { await run(); }
    catch (error) { console.error("[event-worker]", error); await heartbeat({ state: "error" }).catch(() => {}); }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

main().catch(console.error);
process.on("SIGTERM", async () => { await pool.end(); process.exit(0); });
