import { NextResponse } from "next/server";
import { databaseConfigured, pool } from "@/db";
import { getRedis, isRedisConfigured } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = { app: "ok" };
  let healthy = true;

  if (!databaseConfigured) {
    healthy = false;
    checks.postgresql = "not_configured";
  } else {
    try {
      await pool.query("select 1");
      checks.postgresql = "ok";
    } catch {
      healthy = false;
      checks.postgresql = "error";
    }
  }

  if (!isRedisConfigured()) {
    healthy = false;
    checks.redis = "not_configured";
  } else {
    try {
      const redis = getRedis();
      if (redis.status === "wait") await redis.connect();
      const pong = await redis.ping();
      checks.redis = pong === "PONG" ? "ok" : "error";
      if (pong !== "PONG") healthy = false;
    } catch {
      healthy = false;
      checks.redis = "error";
    }
  }

  // Keep component-level health details server-side. The public endpoint is used
  // by deployment/load-balancer checks and should not disclose the stack.
  if (!healthy) console.error("[health] dependency check failed", checks);
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
