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
    const result = await db.execute(sql`select count(*)::int as total,count(*) filter(where status in ('queued','ready_for_transport','sending','mta_accepted','deferred'))::int as active from messages where campaign_id=${campaign.id}`);
    const row = (result.rows[0] || {}) as Record<string, unknown>;
    if (Number(row.total || 0) > 0 && Number(row.active || 0) === 0) {
      await db.update(campaigns).set({ status: "completed", updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
      await emitWebhookEvent("campaign.completed", { campaignId: campaign.id, name: campaign.name }).catch((error) => console.error("[event-worker.webhook]", error));
      completed++;
    }
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
