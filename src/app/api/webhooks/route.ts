import { desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { webhookEndpoints } from "@/db/integration-schema";
import { audit } from "@/lib/audit";
import { canManageInfrastructure, getSession } from "@/lib/auth";
import { encryptWebhookSecret, newWebhookSecret } from "@/lib/webhook-secrets";
import { parseWebhookUrl } from "@/lib/webhook-url";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ configured: false, endpoints: [] });

  const endpoints = await db
    .select({
      id: webhookEndpoints.id,
      name: webhookEndpoints.name,
      url: webhookEndpoints.url,
      active: webhookEndpoints.active,
      createdAt: webhookEndpoints.createdAt,
      updatedAt: webhookEndpoints.updatedAt,
    })
    .from(webhookEndpoints)
    .orderBy(desc(webhookEndpoints.createdAt));
  return NextResponse.json({ configured: true, endpoints });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { name?: string; url?: string } | null;
  const name = String(body?.name || "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "Webhook name is required." }, { status: 400 });

  let url: URL;
  try { url = parseWebhookUrl(String(body?.url || "")); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid webhook URL" }, { status: 400 }); }

  let secret: string;
  let secretCiphertext: string;
  try {
    secret = newWebhookSecret();
    secretCiphertext = encryptWebhookSecret(secret);
  } catch (error) {
    console.error("[webhooks.create]", error);
    return NextResponse.json({ error: "Webhook signing is not configured." }, { status: 503 });
  }

  const [row] = await db
    .insert(webhookEndpoints)
    .values({ name, url: url.toString(), secretCiphertext })
    .returning({ id: webhookEndpoints.id, name: webhookEndpoints.name, url: webhookEndpoints.url, active: webhookEndpoints.active, createdAt: webhookEndpoints.createdAt });

  await audit("webhook.created", session, "webhook", row.id, { name, url: row.url });
  return NextResponse.json({ ...row, secret }, { status: 201 });
}
