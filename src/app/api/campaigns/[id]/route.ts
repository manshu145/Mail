import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { campaigns, lists, sendingAccounts, templates } from "@/db/schema";
import { sendingDomains } from "@/db/operations-schema";
import { resolveAudienceRecipients } from "@/lib/audience";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { isValidEmail } from "@/lib/contact-utils";
import { getRuntimePolicy } from "@/lib/runtime-policy";
import { getCampaignPreflight } from "@/lib/campaign-preflight";

function value(input: unknown) {
  const v = String(input ?? "").trim();
  return v || null;
}

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
  const list = listId ? (await db.select().from(lists).where(eq(lists.id, listId)).limit(1))[0] : null;
  const template = templateId ? (await db.select().from(templates).where(eq(templates.id, templateId)).limit(1))[0] : null;
  const account = sendingAccountId ? (await db.select().from(sendingAccounts).where(eq(sendingAccounts.id, sendingAccountId)).limit(1))[0] : null;

  if (listId && !list) return NextResponse.json({ error: "Selected list does not exist." }, { status: 400 });
  if (templateId && !template) return NextResponse.json({ error: "Selected template does not exist." }, { status: 400 });
  if (sendingAccountId && !account) return NextResponse.json({ error: "Selected sending account does not exist." }, { status: 400 });

  const action = String(body.action || "save");
  if (!["save", "send_now", "schedule", "queue"].includes(action)) return NextResponse.json({ error: "Unknown campaign action." }, { status: 400 });
  const wantsDelivery = action === "send_now" || action === "schedule" || action === "queue";
  const scheduledRaw = value(body.scheduledAt);
  const scheduledAt = action === "send_now" ? null : scheduledRaw ? new Date(scheduledRaw) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return NextResponse.json({ error: "Invalid schedule time." }, { status: 400 });
  if (action === "schedule" && (!scheduledAt || scheduledAt.getTime() <= Date.now())) return NextResponse.json({ error: "Choose a future date and time before scheduling." }, { status: 400 });

  const policy = getRuntimePolicy();
  let audienceSize: number | null = null;

  if (wantsDelivery) {
    if (!list || !template || !account) return NextResponse.json({ error: "Select a list, template and sending account first." }, { status: 400 });
    if (!policy.sendingEnabled) return NextResponse.json({ error: "Sending is disabled by runtime configuration." }, { status: 423 });
    const preflight = await getCampaignPreflight();
    if (!preflight.ok) return NextResponse.json({ error: `Sending pipeline is not healthy: ${preflight.issues.join("; ")}`, preflight }, { status: 503 });
    if (account.status !== "active") return NextResponse.json({ error: "Selected sending account is not active." }, { status: 409 });
    if (!template.htmlBody && !template.textBody) return NextResponse.json({ error: "Template has no email body." }, { status: 409 });

    const fromEmail = (value(body.fromEmail) || account.fromEmail).toLowerCase();
    if (!isValidEmail(fromEmail)) return NextResponse.json({ error: "Sender email is invalid." }, { status: 400 });
    const domain = fromEmail.split("@")[1];
    const [domainRow] = await db.select().from(sendingDomains).where(eq(sendingDomains.domain, domain)).limit(1);
    if (!domainRow || domainRow.status !== "ready" || !domainRow.spfOk || !domainRow.dkimOk || !domainRow.dmarcOk) return NextResponse.json({ error: `Sending domain ${domain} must pass SPF, DKIM and DMARC checks before sending.` }, { status: 409 });

    const recipients = await resolveAudienceRecipients(list);
    audienceSize = recipients.length;
    if (audienceSize === 0) return NextResponse.json({ error: "Selected audience has no active contacts." }, { status: 409 });
    if (policy.maxRecipientsPerCampaign !== null && audienceSize > policy.maxRecipientsPerCampaign) return NextResponse.json({ error: `This runtime allows up to ${policy.maxRecipientsPerCampaign.toLocaleString()} active recipients per campaign. This audience currently has ${audienceSize.toLocaleString()}.` }, { status: 409 });
  }

  const nextStatus = wantsDelivery ? (action === "schedule" || (action === "queue" && scheduledAt && scheduledAt.getTime() > Date.now()) ? "scheduled" : "queued") : "draft";
  await db.update(campaigns).set({
    name: value(body.name) || campaign.name,
    subject: value(body.subject) || campaign.subject,
    preheader: value(body.preheader),
    fromName: value(body.fromName),
    fromEmail: value(body.fromEmail),
    listId, templateId, sendingAccountId,
    trackOpens: body.trackOpens !== false,
    trackClicks: body.trackClicks !== false,
    scheduledAt,
    status: nextStatus,
    updatedAt: new Date(),
  }).where(eq(campaigns.id, id));

  const auditAction = action === "send_now" ? "campaign.send_now_queued" : action === "schedule" ? "campaign.scheduled" : action === "queue" ? "campaign.queued" : "campaign.updated";
  await audit(auditAction, session, "campaign", id, { status: nextStatus, listId, templateId, sendingAccountId, audienceSize, runtimeMode: policy.mode });
  return NextResponse.json({ ok: true, status: nextStatus, audienceSize });
}
