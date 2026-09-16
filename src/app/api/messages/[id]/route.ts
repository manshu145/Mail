import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured, pool } from "@/db";
import { messages } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  const [message] = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { action?: string } | null;

  if (body?.action === "retry" && ["deferred", "failed"].includes(message.status)) {
    await pool.query(
      `update messages
       set status='ready_for_transport',
           last_error=null,
           next_attempt_at=null,
           attempt_count=case when $2::boolean then 0 else attempt_count end
       where id=$1`,
      [id, message.status === "failed"],
    );
    await audit("message.retry", session, "message", id, { previousStatus: message.status });
    return NextResponse.json({ ok: true });
  }

  if (body?.action === "cancel" && ["queued", "ready_for_transport", "deferred"].includes(message.status)) {
    await pool.query(
      `update messages
       set status='cancelled', last_error='cancelled_by_user', next_attempt_at=null
       where id=$1 and status in ('queued','ready_for_transport','deferred')`,
      [id],
    );
    await audit("message.cancelled", session, "message", id, { previousStatus: message.status });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Transition not allowed" }, { status: 409 });
}
