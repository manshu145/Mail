import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { verifyPublicToken } from "@/lib/public-tokens";
import { emitWebhookEvent } from "@/lib/webhooks";
import { classifyTrackingRequest, qualifyOpenEvent } from "@/lib/tracking-classification";

const pixel = Uint8Array.from([71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,249,4,1,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]);
const DEDUPE_MINUTES = 5;

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const payload = await verifyPublicToken(token);
    const messageId = typeof payload.messageId === "string" ? payload.messageId : null;

    if (databaseConfigured && messageId && /^[0-9a-f-]{36}$/i.test(messageId)) {
      const requestClassification = classifyTrackingRequest(request);
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${messageId}))`);
        const contextResult = await tx.execute(sql`
          select m.delivered_at,
            case when ${requestClassification.ipHash || ""}='' then 0 else (
              select count(distinct recent.message_id)::int
              from message_events recent
              where recent.type='open'
                and recent.message_id<>${messageId}::uuid
                and recent.created_at >= now()-interval '10 minutes'
                and recent.payload->>'ipHash'=${requestClassification.ipHash || ""}
            ) end as same_ip_recipients
          from messages m where m.id=${messageId}::uuid
        `);
        const context = contextResult.rows[0] as { delivered_at?: Date | string | null; same_ip_recipients?: number } | undefined;
        const classification = qualifyOpenEvent(requestClassification, {
          deliveredAt: context?.delivered_at || null,
          sameIpDistinctRecipients: Number(context?.same_ip_recipients || 0) + 1,
        });
        const eventPayload = { source: "tracking_pixel", ...classification };
        const result = await tx.execute(sql`
          insert into message_events(message_id,type,payload)
          select ${messageId}::uuid,'open',${JSON.stringify(eventPayload)}::jsonb
          where not exists (
            select 1 from message_events
            where message_id=${messageId}::uuid
              and type='open'
              and created_at >= now() - (${DEDUPE_MINUTES}::int * interval '1 minute')
              and coalesce(payload->>'automated','false') = ${String(classification.automated)}
              and coalesce(payload->>'userAgent','') = ${classification.userAgent || ""}
          )
          returning id
        `);
        return { inserted: result.rows.length > 0, classification };
      });

      if (result.inserted && result.classification.qualified) {
        await emitWebhookEvent("message.opened", { messageId, proxiedBy: result.classification.proxyProvider }).catch((error) => console.error("[tracking.open.webhook]", error));
      }
    }
  } catch (error) {
    console.error("[tracking.open]", error);
  }

  return new NextResponse(pixel, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      "Pragma": "no-cache",
      "Content-Length": String(pixel.length),
    },
  });
}
