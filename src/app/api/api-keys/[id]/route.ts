import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { apiKeys } from "@/db/integration-schema";
import { audit } from "@/lib/audit";
import { canManageInfrastructure, getSession } from "@/lib/auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "revoke") return NextResponse.json({ error: "Unsupported action" }, { status: 400 });

  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "API key not found" }, { status: 404 });
  if (!row.revokedAt) await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
  await audit("api_key.revoked", session, "api_key", id, { name: row.name, prefix: row.keyPrefix });
  return NextResponse.json({ ok: true });
}
