import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { providerCooldowns } from "@/db/operations-schema";
import { providerCooldownEvents } from "@/db/provider-cooldown-event-schema";
import { canManageInfrastructure, getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isUuid } from "@/lib/id";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid cooldown id" }, { status: 400 });
  const body = await request.json().catch(() => null) as { action?: string } | null;
  if (body?.action !== "probe_now") return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const [cooldown] = await db.select().from(providerCooldowns).where(eq(providerCooldowns.id, id)).limit(1);
  if (!cooldown) return NextResponse.json({ error: "Cooldown not found" }, { status: 404 });
  if (!cooldown.active) return NextResponse.json({ error: "Cooldown is already cleared" }, { status: 409 });

  const now = new Date();
  await db.update(providerCooldowns).set({ nextProbeAt: now, updatedAt: now }).where(eq(providerCooldowns.id, id));
  await db.insert(providerCooldownEvents).values({
    cooldownId: id,
    sendingAccountId: cooldown.sendingAccountId,
    provider: cooldown.provider,
    eventType: "manual_probe_requested",
    reason: cooldown.reason,
    response: cooldown.lastResponse,
    metadata: { actorUserId: session.userId, requestedAt: now.toISOString() },
  });
  await audit("provider_cooldown.probe_now", session, "provider_cooldown", id, {});
  return NextResponse.json({ ok: true, nextProbeAt: now.toISOString() });
}
