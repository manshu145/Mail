import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured, pool } from "@/db";
import { campaigns } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const { id } = await params;
  const [source] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!source) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  const [copy] = await db.insert(campaigns).values({
    name: `${source.name} · Copy`,
    subject: source.subject,
    preheader: source.preheader,
    fromName: source.fromName,
    fromEmail: source.fromEmail,
    templateId: source.templateId,
    listId: source.listId,
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

  await audit("campaign.duplicated", session, "campaign", copy.id, { sourceCampaignId: source.id });
  return NextResponse.json({ ok: true, id: copy.id }, { status: 201 });
}
