import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { providerCooldowns } from "@/db/operations-schema";
import { providerCooldownEvents } from "@/db/provider-cooldown-event-schema";
import { canManageInfrastructure, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as { action?: string } | null;
  if (body?.action !== "clear" && body?.action !== "reactivate") return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const [cooldown] = await db.select().from(providerCooldowns).where(eq(providerCooldowns.id, id)).limit(1);
  if (!cooldown) return NextResponse.json({ error: "Cooldown not found" }, { status: 404 });

  const now = new Date();
  if (body.action === "clear") {
    await db.update(providerCooldowns).set({ active: false, clearedAt: now, nextProbeAt: null, updatedAt: now }).where(eq(providerCooldowns.id, id));
    await db.insert(providerCooldownEvents).values({ cooldownId: id, sendingAccountId: cooldown.sendingAccountId, provider: cooldown.provider, eventType: "manual_clear", reason: cooldown.reason, response: cooldown.lastResponse, metadata: { actorUserId: session.userId } });
  } else {
    await db.update(providerCooldowns).set({ active: true, clearedAt: null, nextProbeAt: now, updatedAt: now }).where(eq(providerCooldowns.id, id));
    await db.insert(providerCooldownEvents).values({ cooldownId: id, sendingAccountId: cooldown.sendingAccountId, provider: cooldown.provider, eventType: "manual_reactivate", reason: cooldown.reason, response: cooldown.lastResponse, metadata: { actorUserId: session.userId, nextProbeAt: now.toISOString() } });
  }
  await audit(`provider_cooldown.${body.action}`, session, "provider_cooldown", id, {});
  return NextResponse.json({ ok: true });
}
