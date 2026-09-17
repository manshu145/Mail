import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { campaigns, sendingAccounts, templates } from "@/db/schema";
import { inboxTests, seedInboxes, sendingDomains } from "@/db/operations-schema";
import { getSession, canManageInfrastructure } from "@/lib/auth";
import { getRuntimePolicy } from "@/lib/runtime-policy";
import { submitToMta } from "@/lib/mta-submit";
import { loadCampaignAttachments } from "@/lib/campaign-attachments";
import { loadTemplateAttachments } from "@/lib/template-attachments";
import { buildMimeContent } from "@/lib/mime-email";
import { injectPreheader } from "@/lib/email-preheader";
import { audit } from "@/lib/audit";

function clean(value: string | null | undefined) { return String(value || "").replace(/[\r\n]+/g, " ").trim(); }
function sample(value: string, recipient: string) {
  const first = recipient.split("@")[0]?.split(/[._-]/)[0] || "Seed";
  return value
    .replaceAll("{{first_name}}", first.charAt(0).toUpperCase() + first.slice(1))
    .replaceAll("{{last_name}}", "Inbox")
    .replaceAll("{{email}}", recipient)
    .replaceAll("{{unsubscribe_url}}", `${String(process.env.APP_URL || "").replace(/\/$/, "")}/`);
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageInfrastructure(session.role)) return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  if (!getRuntimePolicy().sendingEnabled) return NextResponse.json({ error: "Sending is disabled by runtime configuration" }, { status: 423 });

  const { id } = await params;
  const [test] = await db.select().from(inboxTests).where(eq(inboxTests.id, id)).limit(1);
  if (!test) return NextResponse.json({ error: "Inbox test not found" }, { status: 404 });
  if (!test.campaignId) return NextResponse.json({ error: "Attach a campaign to this inbox test first" }, { status: 409 });
  if (test.status === "completed") return NextResponse.json({ error: "Inbox test is already completed" }, { status: 409 });

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, test.campaignId)).limit(1);
  if (!campaign?.templateId || !campaign.sendingAccountId) return NextResponse.json({ error: "Campaign needs a template and sending account" }, { status: 409 });

  const [[template], [account], seeds] = await Promise.all([
    db.select().from(templates).where(eq(templates.id, campaign.templateId)).limit(1),
    db.select().from(sendingAccounts).where(eq(sendingAccounts.id, campaign.sendingAccountId)).limit(1),
    db.select().from(seedInboxes).where(eq(seedInboxes.active, true)),
  ]);
  if (!template || !account || account.status !== "active") return NextResponse.json({ error: "Template or active sending account unavailable" }, { status: 409 });
  if (!seeds.length) return NextResponse.json({ error: "No active seed inboxes configured" }, { status: 409 });

  const fromEmail = clean(campaign.fromEmail || account.fromEmail).toLowerCase();
  const fromName = clean(campaign.fromName || account.fromName);
  const sendingDomain = fromEmail.split("@")[1] || "";
  const [domain] = await db.select().from(sendingDomains).where(eq(sendingDomains.domain, sendingDomain)).limit(1);
  if (!domain || domain.status !== "ready") return NextResponse.json({ error: `Sending domain ${sendingDomain} is not ready` }, { status: 409 });

  const [templateAttachments, campaignAttachments] = await Promise.all([
    loadTemplateAttachments(template.id),
    loadCampaignAttachments(campaign.id),
  ]);
  const attachments = [...templateAttachments, ...campaignAttachments];
  const appUrl = String(process.env.APP_URL || "").replace(/\/$/, "");
  const results: Array<{ email: string; ok: boolean; queueId?: string; error?: string }> = [];

  for (const seed of seeds) {
    const marker = id.replaceAll("-", "").slice(0, 12);
    const subject = `[SEED ${marker}] ${clean(campaign.subject || template.subject || "Inbox placement test")}`;
    const preheader = sample(campaign.preheader || "", seed.email);
    let html = injectPreheader(sample(template.htmlBody, seed.email), preheader);
    let text = sample(template.textBody, seed.email);
    if (!html.includes(appUrl) && appUrl) html += `<div style="display:none">${appUrl}</div>`;
    if (!text && html) text = "Inbox placement test message.";
    const messageId = randomUUID();
    const mime = buildMimeContent({ text, html, boundarySeed: `seed_${messageId.replaceAll("-", "")}`, attachments });
    const raw = [
      `From: ${fromName} <${fromEmail}>`, `To: ${seed.email}`, `Reply-To: ${clean(account.replyTo || account.fromEmail)}`,
      `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <seed-${messageId}@${sendingDomain}>`,
      `X-NexiMail-Inbox-Test: ${id}`, `X-NexiMail-Seed-Inbox: ${seed.id}`, "MIME-Version: 1.0", mime.contentTypeHeader, "", ...mime.bodyLines,
    ].join("\r\n");
    try {
      const sent = await submitToMta(raw, fromEmail, seed.email);
      results.push({ email: seed.email, ok: true, queueId: sent.queueId || undefined });
    } catch (error) {
      results.push({ email: seed.email, ok: false, error: error instanceof Error ? error.message.slice(0, 500) : "send_failed" });
    }
  }

  const sentCount = results.filter((item) => item.ok).length;
  await db.update(inboxTests).set({ status: sentCount ? "running" : "failed" }).where(eq(inboxTests.id, id));
  await audit("inbox_test.sent", session, "inbox_test", id, { campaignId: campaign.id, seeds: seeds.length, sent: sentCount, failed: seeds.length - sentCount });

  return NextResponse.json({ ok: sentCount > 0, sent: sentCount, failed: seeds.length - sentCount, results }, { status: sentCount ? 200 : 502 });
}
