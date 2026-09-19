import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { webhookEndpoints } from "@/db/integration-schema";
import { audit } from "@/lib/audit";
import { canManageInfrastructure, getSession } from "@/lib/auth";
import { isUuid } from "@/lib/id";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid webhook id" }, { status: 400 });
  const body = (await request.json().catch(() => null)) as { active?: boolean } | null;
  if (typeof body?.active !== "boolean") return NextResponse.json({ error: "active must be boolean" }, { status: 400 });

  const [existing] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).limit(1);
  if (!existing) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });

  await db.update(webhookEndpoints).set({ active: body.active, updatedAt: new Date() }).where(eq(webhookEndpoints.id, id));
  await audit(body.active ? "webhook.enabled" : "webhook.disabled", session, "webhook", id, { name: existing.name });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid webhook id" }, { status: 400 });
  const [existing] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).limit(1);
  if (!existing) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
  await audit("webhook.deleted", session, "webhook", id, { name: existing.name, url: existing.url });
  return NextResponse.json({ ok: true });
}
