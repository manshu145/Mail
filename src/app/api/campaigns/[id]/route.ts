import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { campaigns, lists, sendingAccounts, templates } from "@/db/schema";
import { getSession } from "@/lib/auth";

function value(input: unknown) { const v = String(input ?? "").trim(); return v || null; }

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  if (!["draft", "paused", "scheduled"].includes(campaign.status)) return NextResponse.json({ error: "This campaign can no longer be edited." }, { status: 409 });

  const listId = value(body.listId);
  const templateId = value(body.templateId);
  const sendingAccountId = value(body.sendingAccountId);
  if (listId && !(await db.select({id:lists.id}).from(lists).where(eq(lists.id, listId)).limit(1)).length) return NextResponse.json({ error: "Selected list does not exist." }, { status: 400 });
  if (templateId && !(await db.select({id:templates.id}).from(templates).where(eq(templates.id, templateId)).limit(1)).length) return NextResponse.json({ error: "Selected template does not exist." }, { status: 400 });
  if (sendingAccountId && !(await db.select({id:sendingAccounts.id}).from(sendingAccounts).where(eq(sendingAccounts.id, sendingAccountId)).limit(1)).length) return NextResponse.json({ error: "Selected sending account does not exist." }, { status: 400 });

  const action = String(body.action || "save");
  const scheduledRaw = value(body.scheduledAt);
  const scheduledAt = scheduledRaw ? new Date(scheduledRaw) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return NextResponse.json({ error: "Invalid schedule time." }, { status: 400 });
  if (action === "queue" && (!listId || !templateId || !sendingAccountId)) return NextResponse.json({ error: "Select a list, template and sending account before queueing." }, { status: 400 });

  const nextStatus = action === "queue" ? (scheduledAt && scheduledAt.getTime() > Date.now() ? "scheduled" : "queued") : "draft";
  await db.update(campaigns).set({
    name: value(body.name) || campaign.name,
    subject: value(body.subject) || campaign.subject,
    preheader: value(body.preheader),
    fromName: value(body.fromName),
    fromEmail: value(body.fromEmail),
    listId,
    templateId,
    sendingAccountId,
    trackOpens: body.trackOpens !== false,
    trackClicks: body.trackClicks !== false,
    scheduledAt,
    status: nextStatus,
    updatedAt: new Date(),
  }).where(eq(campaigns.id, id));

  return NextResponse.json({ ok: true, status: nextStatus });
}
