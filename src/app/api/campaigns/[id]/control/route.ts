import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, databaseConfigured, pool } from "@/db";
import { campaigns, messages } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  const body = await request.json().catch(() => null) as { action?: string } | null;
  const action = body?.action || "";
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  if (action === "cancel") {
    if (["completed", "cancelled"].includes(campaign.status)) return NextResponse.json({ error: "Campaign is already terminal" }, { status: 409 });
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(campaigns).set({ status: "cancelled", cancelledAt: now, lastError: null, updatedAt: now }).where(eq(campaigns.id, id));
    });
    await pool.query(`update messages set status='cancelled',last_error='campaign_cancelled',next_attempt_at=null where campaign_id=$1 and status in ('queued','ready_for_transport','deferred')`, [id]);
    await audit("campaign.cancelled", session, "campaign", id, { previousStatus: campaign.status, cancelledAt: now.toISOString() });
    return NextResponse.json({ ok: true, status: "cancelled" });
  }

  if (action === "pause") {
    if (!["queued", "scheduled", "sending"].includes(campaign.status)) return NextResponse.json({ error: "Only queued, scheduled, or sending campaigns can be paused." }, { status: 409 });
    await db.update(campaigns).set({ status: "paused", lastError: null, updatedAt: new Date() }).where(eq(campaigns.id, id));
    await audit("campaign.paused", session, "campaign", id, { previousStatus: campaign.status });
    return NextResponse.json({ ok: true, status: "paused" });
  }

  if (action === "resume") {
    if (campaign.status !== "paused") return NextResponse.json({ error: "Campaign is not paused." }, { status: 409 });
    const [counts] = await db.select({ total: sql<number>`count(*)::int` }).from(messages).where(eq(messages.campaignId, id));
    const nextStatus = Number(counts?.total || 0) > 0 ? "sending" : "queued";
    await db.update(campaigns).set({ status: nextStatus, lastError: null, updatedAt: new Date() }).where(eq(campaigns.id, id));
    await audit("campaign.resumed", session, "campaign", id, { status: nextStatus, messageCount: Number(counts?.total || 0) });
    return NextResponse.json({ ok: true, status: nextStatus });
  }

  if (action === "retry_failed") {
    if (campaign.status === "cancelled") return NextResponse.json({ error: "Cancelled campaigns cannot be retried." }, { status: 409 });
    const result = await pool.query<{ id: string }>(`update messages set status='ready_for_transport',last_error=null,next_attempt_at=now(),attempt_count=0 where campaign_id=$1 and status='failed' returning id::text`, [id]);
    if (!result.rowCount) return NextResponse.json({ error: "There are no failed recipients to retry." }, { status: 409 });
    await db.update(campaigns).set({ status: "sending", completedAt: null, lastError: null, updatedAt: new Date() }).where(eq(campaigns.id, id));
    await audit("campaign.failed_recipients_retried", session, "campaign", id, { retried: result.rowCount });
    return NextResponse.json({ ok: true, status: "sending", retried: result.rowCount });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
