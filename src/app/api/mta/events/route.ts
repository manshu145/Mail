import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { messageEvents, messages, suppressions } from "@/db/schema";
import { classifyBounce } from "@/lib/bounce-classification";
import { normalizeEmail } from "@/lib/contact-utils";
import { emitWebhookEvent } from "@/lib/webhooks";

const allowed = new Set(["delivered", "deferred", "bounced", "failed", "complaint"]);
const terminal = new Set(["delivered", "bounced", "failed", "cancelled"]);
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
  const detail = String(body.detail || body.remoteCode || "").slice(0, 1000);
  const base = { messageId: message.id, campaignId: message.campaignId, recipientEmail: message.recipientEmail, remoteCode: body.remoteCode || null };

  if (body.status === "complaint") {
    await db.insert(messageEvents).values({ messageId: message.id, type: "complaint", payload: { detail: body.detail || null } });
    // Complaint is a strong explicit suppression reason and may upgrade an older
    // invalid/hard-bounce/manual entry.
    await db.insert(suppressions).values({ email: message.recipientEmail, normalizedEmail: normalizeEmail(message.recipientEmail), reason: "complaint", source: "feedback_loop" }).onConflictDoUpdate({ target: suppressions.normalizedEmail, set: { reason: "complaint", source: "feedback_loop" } });
    await emitWebhookEvent("message.complaint", base).catch((error) => console.error("[mta.webhook]", error));
    return NextResponse.json({ ok: true });
  }

  // A replayed/stale deferred event must never move a terminal message backwards.
  if (body.status === "deferred" && terminal.has(message.status)) return NextResponse.json({ ok: true, ignored: "terminal_message" });

  // Remote deferral is owned by the MTA after local acceptance. Keep the app state
  // as mta_accepted so the transport worker never creates a duplicate submission.
  if (body.status === "deferred") {
    await db.update(messages).set({ status: "mta_accepted", lastError: detail || "deferred" }).where(eq(messages.id, message.id));
    await db.insert(messageEvents).values({ messageId: message.id, type: "mta_deferred", payload: { detail: body.detail || null, remoteCode: body.remoteCode || null } });
    await emitWebhookEvent("message.deferred", base).catch((error) => console.error("[mta.webhook]", error));
    return NextResponse.json({ ok: true });
  }

  // Idempotent terminal replay: do not duplicate timeline/webhook events.
  if (body.status === "delivered" && message.status === "delivered") return NextResponse.json({ ok: true, ignored: "duplicate_terminal_event" });
  if (body.status === "bounced" && message.status === "bounced") return NextResponse.json({ ok: true, ignored: "duplicate_terminal_event" });
  if (body.status === "failed" && message.status === "failed") return NextResponse.json({ ok: true, ignored: "duplicate_terminal_event" });

  const status = body.status as "delivered" | "bounced" | "failed";
  await db.update(messages).set({
    status,
    lastError: status === "delivered" ? null : (detail || status),
    deliveredAt: status === "delivered" ? new Date() : message.deliveredAt,
    bouncedAt: status === "bounced" ? new Date() : message.bouncedAt,
  }).where(eq(messages.id, message.id));

  if (status === "bounced") {
    const classification = classifyBounce(body.remoteCode || null, detail);
    await db.insert(messageEvents).values({
      messageId: message.id,
      type: "mta_bounced",
      payload: { detail: body.detail || null, remoteCode: body.remoteCode || null, bounceKind: classification.kind, bounceReason: classification.reason, recipientSuppressed: classification.suppressRecipient, providerPressure: classification.providerPressure },
    });
    if (classification.suppressRecipient) {
      // Never downgrade an existing unsubscribe/complaint/manual suppression just
      // because another delivery path later reports a hard bounce.
      await db.insert(suppressions).values({
        email: message.recipientEmail,
        normalizedEmail: normalizeEmail(message.recipientEmail),
        reason: "hard_bounce",
        source: "mta_event",
        note: detail || classification.reason,
      }).onConflictDoNothing({ target: suppressions.normalizedEmail });
    }
  } else {
    await db.insert(messageEvents).values({ messageId: message.id, type: `mta_${status}`, payload: { detail: body.detail || null, remoteCode: body.remoteCode || null } });
  }

  await emitWebhookEvent(`message.${status}`, base).catch((error) => console.error("[mta.webhook]", error));
  return NextResponse.json({ ok: true });
}
