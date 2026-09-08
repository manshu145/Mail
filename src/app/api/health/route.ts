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

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
