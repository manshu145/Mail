import { NextRequest, NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { systemSettings } from "@/db/schema";
import { audit } from "@/lib/audit";
import { canManageInfrastructure, getSession } from "@/lib/auth";
import { DELIVERY_SETTING_KEYS, MAX_PROVIDER_COOLDOWN_MINUTES, readDeliverySettings, type DeliverySettings } from "@/lib/delivery-settings";

const numericKeys = Object.keys(DELIVERY_SETTING_KEYS) as Array<keyof DeliverySettings>;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  return NextResponse.json({ settings: await readDeliverySettings() });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json().catch(() => null) as Partial<Record<keyof DeliverySettings, unknown>> | null;
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const current = await readDeliverySettings();
  const next: DeliverySettings = { ...current };
  for (const key of numericKeys) {
    if (!(key in body)) continue;
    const value = Number(body[key]);
    if (!Number.isFinite(value)) return NextResponse.json({ error: `${key} must be numeric.` }, { status: 400 });
    (next[key] as number) = value;
  }

  const constraints: Array<[keyof DeliverySettings, number, number]> = [
    ["maxPerSecond",1,1000],["maxRecipientsPerCampaign",0,10_000_000],["maxRollingHour",0,10_000_000],["maxRolling24h",0,100_000_000],["maxActiveQueued",100,10_000_000],
    ["retryMaxAttempts",1,20],["retryInitialSeconds",10,86_400],["retryMaxSeconds",30,604_800],["retryBackoffMultiplier",1,10],["providerCooldownMinutes",1,MAX_PROVIDER_COOLDOWN_MINUTES],
    ["reputationBounceStopRate",0,1],["reputationComplaintStopRate",0,1],["reputationMinSample",1,10_000_000],
    ["canaryInitialBatch",10,100_000],["canarySecondBatch",10,1_000_000],["canaryThirdBatch",10,5_000_000],["canaryBounceWarnRate",0,1],
  ];
  for (const [key,min,max] of constraints) if (next[key] < min || next[key] > max) return NextResponse.json({ error: `${key} must be between ${min} and ${max}.` }, { status: 400 });
  if (next.retryMaxSeconds < next.retryInitialSeconds) return NextResponse.json({ error: "Maximum retry wait must be at least the initial retry wait." }, { status: 400 });
  if (next.canaryBounceWarnRate >= next.reputationBounceStopRate) return NextResponse.json({ error: "Canary warning rate must be lower than the bounce stop rate." }, { status: 400 });

  await db.transaction(async (tx) => {
    for (const key of numericKeys) {
      if (!(key in body)) continue;
      const dbKey = DELIVERY_SETTING_KEYS[key];
      await tx.insert(systemSettings).values({ key: dbKey, value: next[key], updatedAt: new Date() }).onConflictDoUpdate({ target: systemSettings.key, set: { value: next[key], updatedAt: new Date() } });
    }
  });
  await audit("delivery_settings.updated", session, "system_settings", "delivery", { changed: numericKeys.filter((key) => key in body), values: next });
  return NextResponse.json({ ok: true, settings: await readDeliverySettings() });
}
