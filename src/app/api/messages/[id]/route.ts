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
    const client = await pool.connect();
    try {
      await client.query("begin");
      const campaign = await client.query("select status from campaigns where id=$1 for update", [message.campaignId]);
      if (!campaign.rows[0] || campaign.rows[0].status === "cancelled") {
        await client.query("rollback");
        return NextResponse.json({ error: "Campaign cannot be retried." }, { status: 409 });
      }
      const result = await client.query(`update messages set status='ready_for_transport',last_error=null,next_attempt_at=now(),
        attempt_count=case when status='failed' then 0 else attempt_count end
        where id=$1 and status in ('deferred','failed') and accepted_at is null and provider_message_id is null
          and coalesce(last_error,'') not in ('transport_submission_uncertain','transport_state_uncertain_after_worker_restart')`, [id]);
      if (!result.rowCount) {
        await client.query("rollback");
        return NextResponse.json({ error: "Retry blocked: message changed or delivery requires reconciliation." }, { status: 409 });
      }
      // A deliberate pause remains paused; a completed campaign must reopen.
      await client.query("update campaigns set status='sending',completed_at=null,updated_at=now() where id=$1 and status='completed'", [message.campaignId]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
    await audit("message.retry", session, "message", id, { previousStatus: message.status });
    return NextResponse.json({ ok: true });
  }

  if (body?.action === "cancel" && ["queued", "ready_for_transport", "deferred"].includes(message.status)) {
    const cancelled = await pool.query(
      `update messages
       set status='cancelled', last_error='cancelled_by_user', next_attempt_at=null
       where id=$1 and status in ('queued','ready_for_transport','deferred')`,
      [id],
    );
    if (!cancelled.rowCount) return NextResponse.json({ error: "Message changed; refresh its delivery state." }, { status: 409 });
    await audit("message.cancelled", session, "message", id, { previousStatus: message.status });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Transition not allowed" }, { status: 409 });
}
