import { NextResponse } from "next/server";
import { pool } from "@/db";
import { redis } from "@/lib/redis";

export async function GET() {
  const checks: Record<string, string> = { app: "ok" };
  let healthy = true;

  try {
    await pool.query("select 1");
    checks.postgresql = "ok";
  } catch {
    healthy = false;
    checks.postgresql = "error";
  }

  try {
    const pong = await redis.ping();
    checks.redis = pong === "PONG" ? "ok" : "error";
    if (pong !== "PONG") healthy = false;
  } catch {
    healthy = false;
    checks.redis = "error";
  }

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, timestamp: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
