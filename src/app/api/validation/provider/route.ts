import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { systemSettings } from "@/db/schema";
import { audit } from "@/lib/audit";
import { canManageInfrastructure, getSession } from "@/lib/auth";
import { encryptWorkspaceSecret, encryptedSettingHint } from "@/lib/secure-setting";

const KEY = "validation.supersend_api_key";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ configured: false, hint: null });

  const [row] = await db.select({ value: systemSettings.value, updatedAt: systemSettings.updatedAt })
    .from(systemSettings).where(eq(systemSettings.key, KEY)).limit(1);

  const workspaceConfigured = Boolean(row?.value);
  const environmentConfigured = Boolean(String(process.env.SUPERSEND_API_KEY || "").trim());
  return NextResponse.json({
    configured: workspaceConfigured || environmentConfigured,
    workspaceConfigured,
    source: workspaceConfigured ? "workspace" : environmentConfigured ? "environment" : null,
    hint: workspaceConfigured ? encryptedSettingHint(row?.value) : environmentConfigured ? "Environment key" : null,
    updatedAt: row?.updatedAt || null,
    canManage: canManageInfrastructure(session.role),
  });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required." }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });

  const body = await request.json().catch(() => null) as { apiKey?: string } | null;
  const apiKey = String(body?.apiKey || "").trim();
  if (apiKey.length < 12 || apiKey.length > 300) return NextResponse.json({ error: "Enter a valid Supersend API key." }, { status: 400 });

  const encrypted = encryptWorkspaceSecret(apiKey);
  await db.insert(systemSettings).values({ key: KEY, value: encrypted })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: encrypted, updatedAt: new Date() } });

  await audit("validation.provider_key.updated", session, "system_setting", KEY, { provider: "supersend" });
  return NextResponse.json({ ok: true, configured: true, hint: encrypted.hint });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required." }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });

  await db.delete(systemSettings).where(eq(systemSettings.key, KEY));
  await audit("validation.provider_key.removed", session, "system_setting", KEY, { provider: "supersend" });
  const environmentConfigured = Boolean(String(process.env.SUPERSEND_API_KEY || "").trim());
  return NextResponse.json({ ok: true, configured: environmentConfigured, source: environmentConfigured ? "environment" : null });
}
