import { NextResponse } from "next/server";
import { db, databaseConfigured } from "@/db";
import { messageEvents } from "@/db/schema";
import { verifyPublicToken } from "@/lib/public-tokens";

const pixel = Uint8Array.from([71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,249,4,1,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]);

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const payload = await verifyPublicToken(token);
    const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
    if (databaseConfigured && messageId && /^[0-9a-f-]{36}$/i.test(messageId)) {
      await db.insert(messageEvents).values({ messageId, type: "open", payload: { source: "tracking_pixel" } });
    }
  } catch { /* pixel remains intentionally non-blocking */ }
  return new NextResponse(pixel, { status: 200, headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0", "Content-Length": String(pixel.length) } });
}
