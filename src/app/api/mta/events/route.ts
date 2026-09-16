import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { messageEvents, messages, suppressions } from "@/db/schema";
import { normalizeEmail } from "@/lib/contact-utils";
import { emitWebhookEvent } from "@/lib/webhooks";

const allowed = new Set(["delivered", "deferred", "bounced", "failed", "complaint"]);
function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export async function POST(request: NextRequest) {
  if (!databaseConfigured) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const expected = process.env.MTA_EVENT_SECRET || "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!expected || !provided || !safeEqual(provided, expected)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { messageId?: string; status?: string; detail?: string; remoteCode?: string } | null;
  if (!body?.messageId || !body.status || !allowed.has(body.status)) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  const [message] = await db.select().from(messages).where(eq(messages.id, body.messageId)).limit(1);
  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
  const base = { messageId: message.id, campaignId: message.campaignId, recipientEmail: message.recipientEmail, remoteCode: body.remoteCode || null };

  if (body.status === "complaint") {
    await db.insert(messageEvents).values({ messageId: message.id, type: "complaint", payload: { detail: body.detail || null } });
    await db.insert(suppressions).values({ email: message.recipientEmail, normalizedEmail: normalizeEmail(message.recipientEmail), reason: "complaint", source: "feedback_loop" }).onConflictDoUpdate({ target: suppressions.normalizedEmail, set: { reason: "complaint", source: "feedback_loop" } });
    await emitWebhookEvent("message.complaint", base).catch((error) => console.error("[mta.webhook]", error));
    return NextResponse.json({ ok: true });
  }

  // Remote deferral is owned by the MTA after local acceptance. Keep the app state
  // as mta_accepted so the transport worker never creates a duplicate submission.
  if (body.status === "deferred") {
    await db.update(messages).set({ status: "mta_accepted", lastError: (body.detail || body.remoteCode || "deferred").slice(0, 1000) }).where(eq(messages.id, message.id));
    await db.insert(messageEvents).values({ messageId: message.id, type: "mta_deferred", payload: { detail: body.detail || null, remoteCode: body.remoteCode || null } });
    await emitWebhookEvent("message.deferred", base).catch((error) => console.error("[mta.webhook]", error));
    return NextResponse.json({ ok: true });
  }

  const status = body.status as "delivered" | "bounced" | "failed";
  await db.update(messages).set({ status, lastError: status === "delivered" ? null : (body.detail || body.remoteCode || status).slice(0, 1000), deliveredAt: status === "delivered" ? new Date() : message.deliveredAt, bouncedAt: status === "bounced" ? new Date() : message.bouncedAt }).where(eq(messages.id, message.id));
  await db.insert(messageEvents).values({ messageId: message.id, type: `mta_${status}`, payload: { detail: body.detail || null, remoteCode: body.remoteCode || null } });
  if (status === "bounced") await db.insert(suppressions).values({ email: message.recipientEmail, normalizedEmail: normalizeEmail(message.recipientEmail), reason: "hard_bounce", source: "mta_event" }).onConflictDoUpdate({ target: suppressions.normalizedEmail, set: { reason: "hard_bounce", source: "mta_event" } });
  await emitWebhookEvent(`message.${status}`, base).catch((error) => console.error("[mta.webhook]", error));
  return NextResponse.json({ ok: true });
}
