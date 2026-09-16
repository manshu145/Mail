import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { apiKeys } from "@/db/integration-schema";
import { audit } from "@/lib/audit";
import { API_SCOPES, newApiKey, normalizeScopes } from "@/lib/api-keys";
import { canManageInfrastructure, getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ configured: false, keys: [], scopes: API_SCOPES });

  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt));

  return NextResponse.json({ configured: true, keys: rows, scopes: API_SCOPES });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { name?: string; scopes?: unknown } | null;
  const name = String(body?.name || "").trim().slice(0, 120);
  const scopes = normalizeScopes(body?.scopes);
  if (!name) return NextResponse.json({ error: "Key name is required." }, { status: 400 });
  if (!scopes.length) return NextResponse.json({ error: "Select at least one scope." }, { status: 400 });

  const generated = newApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({ name, keyPrefix: generated.prefix, keyHash: generated.hash, scopes })
    .returning({ id: apiKeys.id, name: apiKeys.name, keyPrefix: apiKeys.keyPrefix, scopes: apiKeys.scopes, createdAt: apiKeys.createdAt });

  await audit("api_key.created", session, "api_key", row.id, { name, scopes });
  return NextResponse.json({ ...row, secret: generated.raw }, { status: 201 });
}
