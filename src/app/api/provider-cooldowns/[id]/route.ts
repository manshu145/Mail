import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { providerCooldowns } from "@/db/operations-schema";
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
  const now = new Date();
  if (body.action === "clear") await db.update(providerCooldowns).set({ active: false, clearedAt: now, nextProbeAt: null, updatedAt: now }).where(eq(providerCooldowns.id, id));
  else await db.update(providerCooldowns).set({ active: true, clearedAt: null, nextProbeAt: now, updatedAt: now }).where(eq(providerCooldowns.id, id));
  await audit(`provider_cooldown.${body.action}`, session, "provider_cooldown", id, {});
  return NextResponse.json({ ok: true });
}
