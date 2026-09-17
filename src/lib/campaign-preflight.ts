import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { workerHeartbeats } from "@/db/operations-schema";

const CRITICAL_WORKERS = ["campaign", "policy", "transport"] as const;

export type CampaignPreflight = {
  ok: boolean;
  issues: string[];
  workers: Array<{ name: string; online: boolean; ageSeconds: number | null; state: string | null }>;
};

export async function getCampaignPreflight(maxAgeSeconds = 120): Promise<CampaignPreflight> {
  const rows = await db.select().from(workerHeartbeats).where(inArray(workerHeartbeats.workerName, [...CRITICAL_WORKERS]));
  const byName = new Map(rows.map((row) => [row.workerName, row]));
  const now = Date.now();
  const issues: string[] = [];
  const workers = CRITICAL_WORKERS.map((name) => {
    const row = byName.get(name);
    const ageSeconds = row ? Math.max(0, Math.floor((now - row.lastSeenAt.getTime()) / 1000)) : null;
    const state = row && typeof row.metadata?.state === "string" ? row.metadata.state : null;
    const online = Boolean(row && ageSeconds !== null && ageSeconds <= maxAgeSeconds && state !== "error" && state !== "stopped");
    if (!online) issues.push(!row ? `${name} worker has not reported yet` : `${name} worker heartbeat is stale or unhealthy`);
    return { name, online, ageSeconds, state };
  });
  return { ok: issues.length === 0, issues, workers };
}
