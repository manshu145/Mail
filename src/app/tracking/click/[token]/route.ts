import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { messageEvents, messages } from "@/db/schema";
import { verifyPublicToken } from "@/lib/public-tokens";
import { emitWebhookEvent } from "@/lib/webhooks";
import { classifyTrackingRequest, qualifyClickEvent } from "@/lib/tracking-classification";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const fallback = new URL("/", request.url);
  try {
    const { token } = await params;
    const payload = await verifyPublicToken(token);
    const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
    const target = typeof payload.url === "string" ? payload.url : null;
    if (!target || !/^https?:\/\//i.test(target)) return NextResponse.redirect(fallback, 302);
    if (databaseConfigured && messageId && /^[0-9a-f-]{36}$/i.test(messageId)) {
      const requestClassification = classifyTrackingRequest(request);
      const [message] = await db.select({ deliveredAt: messages.deliveredAt }).from(messages).where(eq(messages.id, messageId)).limit(1);

      const recentIpRecipients = requestClassification.ipHash
        ? await db.execute(sql`select count(distinct message_id)::int count
            from message_events
            where type='click'
              and message_id<>${messageId}::uuid
              and created_at >= now()-interval '10 minutes'
              and payload->>'ipHash'=${requestClassification.ipHash}`)
        : { rows: [{ count: 0 }] };

      const sameIpDistinctRecipients = Number((recentIpRecipients.rows[0] as Record<string, unknown> | undefined)?.count || 0) + 1;
      const classification = qualifyClickEvent(requestClassification, {
        deliveredAt: message?.deliveredAt || null,
        sameIpDistinctRecipients,
      });

      await db.insert(messageEvents).values({
        messageId,
        type: "click",
        payload: { url: target, source: "tracking_click", ...classification },
      });

      if (classification.qualified) {
        await emitWebhookEvent("message.clicked", { messageId, url: target }).catch((error) => console.error("[tracking.click.webhook]", error));
      }
    }
    return NextResponse.redirect(target, 302);
  } catch {
    return NextResponse.redirect(fallback, 302);
  }
}
