import { NextRequest, NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { campaigns, contactLists, lists } from "@/db/schema";
import { engagementSegmentDefinitions } from "@/db/segment-schema";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { ENGAGEMENT_RULES, resolveEngagementAudience, type EngagementRule } from "@/lib/engagement-audience";
import { eq } from "drizzle-orm";

function parseRule(value: string | null): EngagementRule | null {
  const rule = String(value || "") as EngagementRule;
  return ENGAGEMENT_RULES.includes(rule) ? rule : null;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const campaignId = String(request.nextUrl.searchParams.get("campaignId") || "").trim();
  const ruleType = parseRule(request.nextUrl.searchParams.get("ruleType"));
  const rawWindow = request.nextUrl.searchParams.get("windowDays");
  const windowDays = rawWindow ? Math.max(1, Math.min(3650, Math.floor(Number(rawWindow)))) : null;
  if (!campaignId || !ruleType) return NextResponse.json({ error: "Campaign and engagement rule are required." }, { status: 400 });

  const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  try {
    const recipients = await resolveEngagementAudience(campaignId, ruleType, windowDays);
    return NextResponse.json({ ok: true, members: recipients.length });
  } catch (error) {
    console.error("[engagement-segment.preview]", error);
    return NextResponse.json({ error: "Could not preview this audience." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json().catch(() => null) as { name?: string; description?: string; campaignId?: string; ruleType?: string; windowDays?: number | null; mode?: "dynamic" | "static" } | null;
  const name = String(body?.name || "").trim().slice(0, 120);
  const description = String(body?.description || "").trim().slice(0, 500) || null;
  const campaignId = String(body?.campaignId || "").trim();
  const ruleType = parseRule(String(body?.ruleType || ""));
  const mode = body?.mode === "static" ? "static" : "dynamic";
  const windowDays = body?.windowDays ? Math.max(1, Math.min(3650, Math.floor(Number(body.windowDays)))) : null;
  if (!name || !campaignId || !ruleType) return NextResponse.json({ error: "Name, campaign and engagement rule are required." }, { status: 400 });

  const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  try {
    const recipients = mode === "static" ? await resolveEngagementAudience(campaignId, ruleType, windowDays) : [];
    const result = await db.transaction(async (tx) => {
      const [list] = await tx.insert(lists).values({ name, description, isDynamic: mode === "dynamic" }).returning({ id: lists.id });
      if (mode === "dynamic") {
        await tx.insert(engagementSegmentDefinitions).values({ listId: list.id, campaignId, ruleType, windowDays });
      } else {
        for (let offset = 0; offset < recipients.length; offset += 1000) {
          const chunk = recipients.slice(offset, offset + 1000).map((r) => ({ contactId: r.contactId, listId: list.id }));
          if (chunk.length) await tx.insert(contactLists).values(chunk).onConflictDoNothing({ target: [contactLists.contactId, contactLists.listId] });
        }
      }
      return list;
    });
    await audit("engagement_segment.created", session, mode === "dynamic" ? "segment" : "list", result.id, { campaignId, ruleType, windowDays, mode, members: recipients.length });
    return NextResponse.json({ ok: true, id: result.id, mode, members: mode === "static" ? recipients.length : null }, { status: 201 });
  } catch (error) {
    console.error("[engagement-segment.create]", error);
    return NextResponse.json({ error: "Could not create engagement audience. The name may already exist." }, { status: 409 });
  }
}
