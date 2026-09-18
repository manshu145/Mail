import { NextRequest, NextResponse } from "next/server";
import { databaseConfigured } from "@/db";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { CampaignControlError, controlCampaign } from "@/lib/campaign-control";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
  const body = await request.json().catch(() => null) as { action?: string } | null;
  if (!body?.action || !["cancel", "pause", "resume", "retry_failed"].includes(body.action)) return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  try {
    const result = await controlCampaign(id, body.action);
    await audit(`campaign.${body.action}`, session, "campaign", id, result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CampaignControlError) return NextResponse.json({ error: error.message }, { status: error.message === "Campaign not found" ? 404 : 409 });
    console.error("[campaign-control] database operation failed");
    return NextResponse.json({ error: "Campaign action could not be completed. Refresh before retrying." }, { status: 503 });
  }
}
