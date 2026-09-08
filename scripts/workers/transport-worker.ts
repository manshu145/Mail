import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { campaigns, contacts, messages, sendingAccounts, templates } from "../../src/db/schema";
import { signPublicToken } from "../../src/lib/public-tokens";

const sendmailPath = process.env.POSTFIX_SENDMAIL_PATH || "/usr/sbin/sendmail";
const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
const perSecond = Math.max(1, Number(process.env.TRANSPORT_RATE_PER_SECOND || "1"));
const delayMs = Math.ceil(1000 / perSecond);

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function personalize(value: string, contact: typeof contacts.$inferSelect) {
  return value
    .replaceAll("{{first_name}}", contact.firstName || "")
    .replaceAll("{{last_name}}", contact.lastName || "")
    .replaceAll("{{email}}", contact.email);
}

async function rewriteLinks(html: string, messageId: string) {
  if (!appUrl) return html;
  const matches = [...html.matchAll(/href=(['"])(https?:\/\/[^'\"]+)\1/gi)];
  let output = html;
  for (const match of matches) {
    const target = match[2];
    const token = await signPublicToken({ messageId, url: target }, "30d");
    output = output.replace(match[0], `href=${match[1]}${appUrl}/tracking/click/${token}${match[1]}`);
  }
  return output;
}

async function sendRaw(raw: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(sendmailPath, ["-i", "-t"], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `sendmail exited ${code}`)));
    child.stdin.end(raw);
  });
}

async function runOnce() {
  if (!appUrl) throw new Error("APP_URL is required for tracking and unsubscribe URLs");
  const ready = await db.select().from(messages).where(eq(messages.status, "ready_for_transport")).limit(50);

  for (const message of ready) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, message.campaignId)).limit(1);
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, message.contactId)).limit(1);
    if (!campaign || !contact || !campaign.sendingAccountId || !campaign.templateId) {
      await db.update(messages).set({ status: "failed", lastError: "campaign_transport_configuration_incomplete" }).where(eq(messages.id, message.id));
      continue;
    }

    const [account] = await db.select().from(sendingAccounts).where(eq(sendingAccounts.id, campaign.sendingAccountId)).limit(1);
    const [template] = await db.select().from(templates).where(eq(templates.id, campaign.templateId)).limit(1);
    if (!account || account.status !== "active" || !template) {
      await db.update(messages).set({ status: "failed", lastError: "sending_account_or_template_unavailable" }).where(eq(messages.id, message.id));
      continue;
    }

    const unsubscribeToken = await signPublicToken({ email: contact.email, messageId: message.id }, "90d");
    const unsubscribeUrl = `${appUrl}/unsubscribe/${unsubscribeToken}`;
    let html = personalize(template.htmlBody, contact).replaceAll("{{unsubscribe_url}}", unsubscribeUrl);
    const text = personalize(template.textBody, contact).replaceAll("{{unsubscribe_url}}", unsubscribeUrl);
    if (campaign.trackClicks) html = await rewriteLinks(html, message.id);
    if (campaign.trackOpens) {
      const openToken = await signPublicToken({ messageId: message.id }, "30d");
      html += `<img src="${appUrl}/tracking/open/${openToken}" width="1" height="1" alt="" style="display:none!important" />`;
    }

    const subject = personalize(campaign.subject || template.subject || "", contact).replace(/[\r\n]+/g, " ");
    const boundary = `neximail_${message.id.replaceAll("-", "")}`;
    const raw = [
      `From: ${campaign.fromName || account.fromName} <${campaign.fromEmail || account.fromEmail}>`,
      `To: ${contact.email}`,
      `Reply-To: ${account.replyTo || account.fromEmail}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `List-Unsubscribe: <${unsubscribeUrl}>`,
      `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
      "",
      text || "This message has an HTML version.",
      "",
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
      "",
      html,
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    await db.update(messages).set({ status: "sending", lastError: null }).where(eq(messages.id, message.id));
    try {
      await sendRaw(raw);
      await db.update(messages).set({ status: "mta_accepted", acceptedAt: new Date(), lastError: null }).where(eq(messages.id, message.id));
      console.log(`[transport-worker] local MTA accepted ${message.id}; not marked delivered`);
    } catch (error) {
      await db.update(messages).set({ status: "deferred", lastError: error instanceof Error ? error.message.slice(0, 1000) : "sendmail_error" }).where(eq(messages.id, message.id));
    }
    await sleep(delayMs);
  }
}

runOnce().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => pool.end());
