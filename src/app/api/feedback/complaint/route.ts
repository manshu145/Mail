import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { messageEvents, messages, suppressions } from "@/db/schema";
import { normalizeEmail, isValidEmail } from "@/lib/contact-utils";
import { emitWebhookEvent } from "@/lib/webhooks";

function authorized(request: NextRequest) {
  const expected = process.env.FEEDBACK_INGEST_SECRET?.trim();
  const supplied = request.headers.get("x-neximail-feedback-secret")?.trim();
  if (!expected || expected.length < 24 || !supplied || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function clean(value: unknown, max = 1000) {
  return String(value ?? "").replace(/[\r\n\0]+/g, " ").trim().slice(0, max);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const email = clean(body.email, 320).toLowerCase();
  const messageId = clean(body.messageId, 64);
  const source = clean(body.source, 80) || "feedback_ingest";
  const feedbackType = clean(body.feedbackType, 120) || "abuse";
  const diagnostic = clean(body.diagnostic, 1000) || null;

  if (!isValidEmail(email)) return NextResponse.json({ error: "A valid recipient email is required" }, { status: 400 });
  if (messageId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(messageId)) {
    return NextResponse.json({ error: "Invalid messageId" }, { status: 400 });
  }

  let message: typeof messages.$inferSelect | null = null;
  if (messageId) {
    const [row] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    message = row || null;
    if (message && normalizeEmail(message.recipientEmail) !== normalizeEmail(email)) {
      return NextResponse.json({ error: "Recipient does not match message" }, { status: 409 });
    }
  }

  await db.insert(suppressions).values({
    email,
    normalizedEmail: normalizeEmail(email),
    reason: "complaint",
    source,
    contactId: message?.contactId || null,
    note: diagnostic || `Complaint: ${feedbackType}`,
  }).onConflictDoUpdate({
    target: suppressions.normalizedEmail,
    set: { reason: "complaint", source, contactId: message?.contactId || null, note: diagnostic || `Complaint: ${feedbackType}` },
  });

  if (message) {
    await db.insert(messageEvents).values({
      messageId: message.id,
      type: "complaint",
      payload: { source, feedbackType, diagnostic, recipientEmail: email },
    });
    await emitWebhookEvent("message.complained", {
      messageId: message.id,
      campaignId: message.campaignId,
      recipientEmail: email,
      source,
      feedbackType,
      diagnostic,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, suppressed: true, correlated: Boolean(message) });
}
