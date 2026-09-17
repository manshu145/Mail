import { NextRequest, NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { campaigns, lists } from "@/db/schema";
import { engagementSegmentDefinitions } from "@/db/segment-schema";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { ENGAGEMENT_RULES, engagementAudienceSql, type EngagementRule } from "@/lib/engagement-audience";
import { eq, sql } from "drizzle-orm";

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
  if (!/^[0-9a-f-]{36}$/i.test(campaignId) || !ruleType || (windowDays !== null && !Number.isFinite(windowDays))) return NextResponse.json({ error: "Campaign and engagement rule are required." }, { status: 400 });

  const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  try {
    const result = await db.execute(sql`select count(*)::int members from (${engagementAudienceSql(campaignId, ruleType, windowDays)}) audience`);
    return NextResponse.json({ ok: true, members: Number(result.rows[0]?.members || 0) });
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
  if (!name || !/^[0-9a-f-]{36}$/i.test(campaignId) || !ruleType || (windowDays !== null && !Number.isFinite(windowDays))) return NextResponse.json({ error: "Name, campaign and engagement rule are required." }, { status: 400 });

  const [campaign] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  try {
    let members = 0;
    const result = await db.transaction(async (tx) => {
      const [list] = await tx.insert(lists).values({ name, description, isDynamic: mode === "dynamic" }).returning({ id: lists.id });
      if (mode === "dynamic") {
        await tx.insert(engagementSegmentDefinitions).values({ listId: list.id, campaignId, ruleType, windowDays });
      } else {
        const selection = engagementAudienceSql(campaignId, ruleType, windowDays);
        await tx.execute(sql`insert into contact_lists(contact_id,list_id) select contact_id,${list.id}::uuid from (${selection}) audience on conflict do nothing`);
        const counts = await tx.execute(sql`select count(*)::int members from contact_lists where list_id=${list.id}`);
        members = Number(counts.rows[0]?.members || 0);
      }
      return list;
    });
    await audit("engagement_segment.created", session, mode === "dynamic" ? "segment" : "list", result.id, { campaignId, ruleType, windowDays, mode, members });
    return NextResponse.json({ ok: true, id: result.id, mode, members: mode === "static" ? members : null }, { status: 201 });
  } catch (error) {
    console.error("[engagement-segment.create]", error);
    return NextResponse.json({ error: "Could not create engagement audience. The name may already exist." }, { status: 409 });
  }
}
