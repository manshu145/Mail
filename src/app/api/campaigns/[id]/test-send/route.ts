import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { campaigns, sendingAccounts, templates } from "@/db/schema";
import { sendingDomains } from "@/db/operations-schema";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";
import { isValidEmail } from "@/lib/contact-utils";
import { submitToMta } from "@/lib/mta-submit";
import { getRuntimePolicy } from "@/lib/runtime-policy";

function clean(value: unknown) { return String(value ?? "").replace(/[\r\n]+/g, " ").trim(); }
function sample(value: string, recipient: string) {
  const first = recipient.split("@")[0]?.split(/[._-]/)[0] || "Test";
  return value
    .replaceAll("{{first_name}}", first.charAt(0).toUpperCase() + first.slice(1))
    .replaceAll("{{last_name}}", "Recipient")
    .replaceAll("{{email}}", recipient)
    .replaceAll("{{unsubscribe_url}}", "#test-unsubscribe");
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  if (!getRuntimePolicy().sendingEnabled) return NextResponse.json({ error: "Sending is disabled by runtime configuration." }, { status: 423 });

  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const recipient = clean(body.recipient).toLowerCase();
  if (!isValidEmail(recipient)) return NextResponse.json({ error: "Enter a valid test recipient." }, { status: 400 });

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

  const templateId = clean(body.templateId) || campaign.templateId || "";
  const accountId = clean(body.sendingAccountId) || campaign.sendingAccountId || "";
  if (!templateId || !accountId) return NextResponse.json({ error: "Select a template and sending account first." }, { status: 400 });

  const [template] = await db.select().from(templates).where(eq(templates.id, templateId)).limit(1);
  const [account] = await db.select().from(sendingAccounts).where(eq(sendingAccounts.id, accountId)).limit(1);
  if (!template || !account || account.status !== "active") return NextResponse.json({ error: "Template or active sending account is unavailable." }, { status: 409 });
  if (!template.htmlBody && !template.textBody) return NextResponse.json({ error: "Template has no email body." }, { status: 409 });

  const fromEmail = (clean(body.fromEmail) || campaign.fromEmail || account.fromEmail).toLowerCase();
  const fromName = clean(body.fromName) || campaign.fromName || account.fromName;
  if (!isValidEmail(fromEmail)) return NextResponse.json({ error: "Sender email is invalid." }, { status: 400 });
  const sendingDomain = fromEmail.split("@")[1];
  const [domain] = await db.select().from(sendingDomains).where(eq(sendingDomains.domain, sendingDomain)).limit(1);
  if (!domain || domain.status !== "ready") return NextResponse.json({ error: `Sending domain ${sendingDomain} is not ready.` }, { status: 409 });

  const subject = `[TEST] ${clean(body.subject) || campaign.subject || template.subject || "NexiMail test"}`;
  const html = sample(template.htmlBody, recipient) + `<div style="margin:24px auto 0;max-width:640px;padding:12px 16px;border-radius:10px;background:#f3f4f6;font-family:Arial,sans-serif;font-size:12px;color:#6b7280;text-align:center">Test send from NexiMail — no campaign recipient was queued.</div>`;
  const text = `${sample(template.textBody, recipient)}${template.textBody ? "\n\n" : ""}Test send from NexiMail — no campaign recipient was queued.`;
  const replyTo = clean(account.replyTo || account.fromEmail);
  const messageId = randomUUID();
  const boundary = `neximail_test_${messageId.replaceAll("-", "")}`;
  const raw = [
    `From: ${clean(fromName)} <${fromEmail}>`, `To: ${recipient}`, `Reply-To: ${replyTo}`, `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <test-${messageId}@${sendingDomain}>`, `X-NexiMail-Test: true`, "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", text || "NexiMail test message", "",
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", html || "<p>NexiMail test message</p>", "", `--${boundary}--`, "",
  ].join("\r\n");

  try {
    const result = await submitToMta(raw, fromEmail, recipient);
    if (!result.queueId) return NextResponse.json({ error: "MTA accepted the message without returning a queue id." }, { status: 502 });
    await audit("campaign.test_sent", session, "campaign", id, { recipient, queueId: result.queueId, sendingAccountId: account.id, templateId: template.id });
    return NextResponse.json({ ok: true, queueId: result.queueId });
  } catch (error) {
    console.error("[campaign.test-send]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Test send failed." }, { status: 502 });
  }
}
