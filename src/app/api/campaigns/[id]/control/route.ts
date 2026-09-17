import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { campaigns, messages } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";

const retryableStatuses = ["failed"] as const;

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
      await tx.update(messages).set({ status: "cancelled", lastError: "campaign_cancelled", nextAttemptAt: null }).where(and(eq(messages.campaignId, id), inArray(messages.status, ["queued", "ready_for_transport", "deferred"])));
    });
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
    if (["cancelled"].includes(campaign.status)) return NextResponse.json({ error: "Cancelled campaigns cannot be retried." }, { status: 409 });
    const result = await db.update(messages).set({ status: "ready_for_transport", lastError: null, nextAttemptAt: new Date(), attemptCount: 0 }).where(and(eq(messages.campaignId, id), inArray(messages.status, [...retryableStatuses]))).returning({ id: messages.id });
    if (!result.length) return NextResponse.json({ error: "There are no failed recipients to retry." }, { status: 409 });
    await db.update(campaigns).set({ status: "sending", completedAt: null, lastError: null, updatedAt: new Date() }).where(eq(campaigns.id, id));
    await audit("campaign.failed_recipients_retried", session, "campaign", id, { retried: result.length });
    return NextResponse.json({ ok: true, status: "sending", retried: result.length });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
