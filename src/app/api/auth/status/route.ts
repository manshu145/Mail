import { NextResponse } from "next/server";
import { getAuthSecret, isDemoAuthEnabled } from "@/lib/auth-policy";

export const dynamic = "force-dynamic";

export async function GET() {
  let sessionKeyReady = false;
  try {
    sessionKeyReady = getAuthSecret().length >= 32;
  } catch {
    sessionKeyReady = false;
  }

  return NextResponse.json({
    demoAuthEnabled: isDemoAuthEnabled(),
    sessionKeyReady,
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    vercelEnvironment: process.env.VERCEL_ENV ?? null,
    projectHost: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
  });
}
