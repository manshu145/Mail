import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { campaignPreflights } from "@/db/campaign-ops-schema";
import { campaigns, lists, sendingAccounts, templates } from "@/db/schema";
import { sendingDomains } from "@/db/operations-schema";
import { preflightAudience } from "@/lib/audience-preflight";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { isValidEmail } from "@/lib/contact-utils";
import { getRuntimePolicy } from "@/lib/runtime-policy";
import { getCampaignSendGuard, type CampaignSendGuard } from "@/lib/campaign-preflight";
import { listCampaignAttachments } from "@/lib/campaign-attachments";
import { listTemplateAttachments } from "@/lib/template-attachments";
import { isUuid } from "@/lib/id";

function value(input: unknown) {
  const v = String(input ?? "").trim();
  return v || null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });

  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid campaign id." }, { status: 400 });
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
  const sendOnlyValidated = body.sendOnlyValidated === true;
  const scheduledRaw = value(body.scheduledAt);
  const scheduledAt = action === "send_now" ? null : scheduledRaw ? new Date(scheduledRaw) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return NextResponse.json({ error: "Invalid schedule time." }, { status: 400 });
  if (action === "schedule" && (!scheduledAt || scheduledAt.getTime() <= Date.now())) return NextResponse.json({ error: "Choose a future date and time before scheduling." }, { status: 400 });

  const policy = getRuntimePolicy();
  let audienceSize: number | null = null;
  let audiencePreflight: Awaited<ReturnType<typeof preflightAudience>> | null = null;
  let sendGuard: CampaignSendGuard | null = null;

  const accountFromEmail = account?.fromEmail?.trim().toLowerCase() || null;
  const accountDomain = accountFromEmail?.split("@")[1] || null;
  const normalizedFromEmail = accountFromEmail;

  if (wantsDelivery) {
    if (!list || !template || !account) return NextResponse.json({ error: "Select a list, template and sending account first." }, { status: 400 });
    if (!policy.sendingEnabled) return NextResponse.json({ error: "Sending is disabled by runtime configuration." }, { status: 423 });
    if (account.status !== "active") return NextResponse.json({ error: "Selected sending account is not active." }, { status: 409 });
    if (!template.htmlBody && !template.textBody) return NextResponse.json({ error: "Template has no email body." }, { status: 409 });

    if (!normalizedFromEmail || !isValidEmail(normalizedFromEmail) || !accountDomain) return NextResponse.json({ error: "Selected sending account has an invalid sender email." }, { status: 409 });
    const domain = accountDomain;
    const [domainRow] = await db.select().from(sendingDomains).where(eq(sendingDomains.domain, domain)).limit(1);
    if (!domainRow || domainRow.status !== "ready" || !domainRow.spfOk || !domainRow.dkimOk || !domainRow.dmarcOk) return NextResponse.json({ error: `Sending domain ${domain} must pass SPF, DKIM and DMARC checks before sending.` }, { status: 409 });

    audiencePreflight = await preflightAudience(list);
    audienceSize = sendOnlyValidated ? audiencePreflight.validCount : audiencePreflight.eligibleCount;
    const [campaignAttachments, templateAttachments] = await Promise.all([
      listCampaignAttachments(id),
      listTemplateAttachments(template.id),
    ]);
    sendGuard = await getCampaignSendGuard({
      sendingAccountId: account.id,
      fromEmail: normalizedFromEmail,
      domain: domainRow,
      audience: audiencePreflight,
      subject: value(body.subject) || campaign.subject || template.subject || "",
      html: template.htmlBody || "",
      text: template.textBody || "",
      attachmentNames: [...campaignAttachments, ...templateAttachments].map((attachment) => attachment.filename),
    });
    await db.insert(campaignPreflights).values({
      campaignId: id,
      listId: list.id,
      rawCount: audiencePreflight.rawCount,
      eligibleCount: audiencePreflight.eligibleCount,
      suppressedCount: audiencePreflight.suppressedCount,
      invalidCount: audiencePreflight.invalidCount,
      validCount: audiencePreflight.validCount,
      pendingCount: audiencePreflight.pendingCount,
      unknownCount: audiencePreflight.unknownCount,
      status: sendGuard.status,
      checks: sendGuard.checks,
      blockingIssues: sendGuard.blockingIssues,
      checkedAt: new Date(),
    }).onConflictDoUpdate({ target: campaignPreflights.campaignId, set: {
      listId: list.id,
      rawCount: audiencePreflight.rawCount,
      eligibleCount: audiencePreflight.eligibleCount,
      suppressedCount: audiencePreflight.suppressedCount,
      invalidCount: audiencePreflight.invalidCount,
      validCount: audiencePreflight.validCount,
      pendingCount: audiencePreflight.pendingCount,
      unknownCount: audiencePreflight.unknownCount,
      status: sendGuard.status,
      checks: sendGuard.checks,
      blockingIssues: sendGuard.blockingIssues,
      checkedAt: new Date(),
    }});

    if (sendGuard.status === "blocked") return NextResponse.json({ error: `Campaign preflight blocked launch: ${sendGuard.blockingIssues.join(" ")}`, audiencePreflight, sendGuard }, { status: 409 });
    if (audienceSize === 0) return NextResponse.json({ error: "Selected audience has no recipients matching the selected validation rule.", audiencePreflight }, { status: 409 });
    if (policy.maxRecipientsPerCampaign !== null && audienceSize > policy.maxRecipientsPerCampaign) return NextResponse.json({ error: `This runtime allows up to ${policy.maxRecipientsPerCampaign.toLocaleString()} eligible recipients per campaign. This audience currently has ${audienceSize.toLocaleString()}.`, audiencePreflight }, { status: 409 });
  }

  const nextStatus = wantsDelivery ? (action === "schedule" || (action === "queue" && scheduledAt && scheduledAt.getTime() > Date.now()) ? "scheduled" : "queued") : "draft";
  await db.update(campaigns).set({
    name: value(body.name) || campaign.name,
    subject: value(body.subject) || campaign.subject,
    preheader: value(body.preheader),
    fromName: account?.fromName || null,
    fromEmail: normalizedFromEmail,
    listId, templateId, sendingAccountId,
    sendOnlyValidated,
    trackOpens: body.trackOpens !== false,
    trackClicks: body.trackClicks !== false,
    scheduledAt,
    status: nextStatus,
    audienceCount: audienceSize ?? campaign.audienceCount,
    lastError: null,
    updatedAt: new Date(),
  }).where(eq(campaigns.id, id));

  const auditAction = action === "send_now" ? "campaign.send_now_queued" : action === "schedule" ? "campaign.scheduled" : action === "queue" ? "campaign.queued" : "campaign.updated";
  await audit(auditAction, session, "campaign", id, { status: nextStatus, listId, templateId, sendingAccountId, sendOnlyValidated, audienceSize, audiencePreflight: audiencePreflight ? { rawCount: audiencePreflight.rawCount, eligibleCount: audiencePreflight.eligibleCount, suppressedCount: audiencePreflight.suppressedCount, invalidCount: audiencePreflight.invalidCount } : null, runtimeMode: policy.mode });
  return NextResponse.json({ ok: true, status: nextStatus, audienceSize, sendGuard, audiencePreflight: audiencePreflight ? { rawCount: audiencePreflight.rawCount, eligibleCount: audiencePreflight.eligibleCount, suppressedCount: audiencePreflight.suppressedCount, invalidCount: audiencePreflight.invalidCount, validCount: audiencePreflight.validCount, pendingCount: audiencePreflight.pendingCount, unknownCount: audiencePreflight.unknownCount, awaitingValidationCount: audiencePreflight.awaitingValidationCount, domainInvalidCount: audiencePreflight.domainInvalidCount, domainHealthPendingCount: audiencePreflight.domainHealthPendingCount, checkedDomainCount: audiencePreflight.checkedDomainCount } : null });
}
