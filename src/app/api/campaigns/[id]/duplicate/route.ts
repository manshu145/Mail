import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured, pool } from "@/db";
import { campaigns, lists } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  const body = await request.json().catch(() => null) as { listId?: string } | null;
  const listId = String(body?.listId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(listId)) return NextResponse.json({ error: "Choose the audience list for the new campaign." }, { status: 400 });

  const [[source], [targetList]] = await Promise.all([
    db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1),
    db.select({ id: lists.id, name: lists.name }).from(lists).where(eq(lists.id, listId)).limit(1),
  ]);
  if (!source) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (!targetList) return NextResponse.json({ error: "Selected audience no longer exists." }, { status: 404 });

  const [copy] = await db.insert(campaigns).values({
    name: `${source.name} · ${targetList.name}`,
    subject: source.subject,
    preheader: source.preheader,
    fromName: source.fromName,
    fromEmail: source.fromEmail,
    templateId: source.templateId,
    listId,
    sendingAccountId: source.sendingAccountId,
    status: "draft",
    trackOpens: source.trackOpens,
    trackClicks: source.trackClicks,
    scheduledAt: null,
    audienceCount: null,
    messageCount: 0,
    lastError: null,
  }).returning({ id: campaigns.id });

  await pool.query(`
    insert into campaign_attachments (campaign_id, filename, content_type, size_bytes, content)
    select $1::uuid, filename, content_type, size_bytes, content
    from campaign_attachments
    where campaign_id=$2::uuid
  `, [copy.id, source.id]);

  await audit("campaign.duplicated", session, "campaign", copy.id, {
    sourceCampaignId: source.id,
    targetListId: listId,
    targetListName: targetList.name,
  });

  return NextResponse.json({ ok: true, id: copy.id, listId, listName: targetList.name }, { status: 201 });
}
