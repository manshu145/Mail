import { NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { messageEvents } from "@/db/schema";
import { verifyPublicToken } from "@/lib/public-tokens";
import { emitWebhookEvent } from "@/lib/webhooks";
import { classifyTrackingRequest } from "@/lib/tracking-classification";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const fallback = new URL("/", request.url);
  try {
    const { token } = await params;
    const payload = await verifyPublicToken(token);
    const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
    const target = typeof payload.url === "string" ? payload.url : null;
    if (!target || !/^https?:\/\//i.test(target)) return NextResponse.redirect(fallback, 302);
    if (databaseConfigured && messageId && /^[0-9a-f-]{36}$/i.test(messageId)) {
      const classification = classifyTrackingRequest(request);
      await db.insert(messageEvents).values({ messageId, type: "click", payload: { url: target, ...classification } });
      if (!classification.automated) await emitWebhookEvent("message.clicked", { messageId, url: target }).catch((error) => console.error("[tracking.click.webhook]", error));
    }
    return NextResponse.redirect(target, 302);
  } catch {
    return NextResponse.redirect(fallback, 302);
  }
}
