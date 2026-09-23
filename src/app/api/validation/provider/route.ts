import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { systemSettings } from "@/db/schema";
import { audit } from "@/lib/audit";
import { canManageInfrastructure, getSession } from "@/lib/auth";
import { encryptWorkspaceSecret, encryptedSettingHint } from "@/lib/secure-setting";
import { DEFAULT_VALIDATION_MODE, normalizeValidationMode, VALIDATION_MODE_KEY, validationModeNeedsSupersend, type ValidationMode } from "@/lib/validation-provider";

const KEY = "validation.supersend_api_key";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ configured: false, hint: null });

  const [[row], [modeRow]] = await Promise.all([
    db.select({ value: systemSettings.value, updatedAt: systemSettings.updatedAt })
      .from(systemSettings).where(eq(systemSettings.key, KEY)).limit(1),
    db.select({ value: systemSettings.value }).from(systemSettings)
      .where(eq(systemSettings.key, VALIDATION_MODE_KEY)).limit(1),
  ]);

  const workspaceConfigured = Boolean(row?.value);
  const mode = normalizeValidationMode(modeRow?.value ?? DEFAULT_VALIDATION_MODE);
  const environmentConfigured = Boolean(String(process.env.SUPERSEND_API_KEY || "").trim());
  return NextResponse.json({
    configured: workspaceConfigured || environmentConfigured,
    workspaceConfigured,
    source: workspaceConfigured ? "workspace" : environmentConfigured ? "environment" : null,
    hint: workspaceConfigured ? encryptedSettingHint(row?.value) : environmentConfigured ? "Environment key" : null,
    updatedAt: row?.updatedAt || null,
    canManage: canManageInfrastructure(session.role),
    mode,
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

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required." }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });

  const body = await request.json().catch(() => null) as { mode?: ValidationMode } | null;
  const mode = normalizeValidationMode(body?.mode);
  if (!body?.mode || !["internal","hybrid","supersend"].includes(String(body.mode))) {
    return NextResponse.json({ error: "Choose Internal, Smart hybrid or SuperSend primary." }, { status: 400 });
  }

  if (validationModeNeedsSupersend(mode)) {
    const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, KEY)).limit(1);
    const configured = Boolean(row?.value) || Boolean(String(process.env.SUPERSEND_API_KEY || "").trim());
    if (!configured) return NextResponse.json({ error: "Add a SuperSend API key before selecting this mode." }, { status: 409 });
  }

  await db.insert(systemSettings).values({ key: VALIDATION_MODE_KEY, value: mode })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: mode, updatedAt: new Date() } });
  await audit("validation.mode.updated", session, "system_setting", VALIDATION_MODE_KEY, { mode });
  return NextResponse.json({ ok: true, mode });
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
