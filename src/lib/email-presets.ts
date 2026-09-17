export type EmailPreset = {
  id: string;
  name: string;
  description: string;
  subject: string;
  htmlBody: string;
  textBody: string;
};

const shell = (title: string, eyebrow: string, body: string, ctaLabel: string, ctaUrl = "https://example.com") => `<!doctype html>
<html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fb;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="padding:28px 32px;background:#111827;color:#ffffff"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a78bfa;font-weight:700">${eyebrow}</div><h1 style="margin:10px 0 0;font-size:30px;line-height:1.15">${title}</h1></td></tr>
<tr><td style="padding:30px 32px;font-size:16px;line-height:1.7">${body}
<div style="margin:28px 0"><a href="${ctaUrl}" style="display:inline-block;background:#6d5dfc;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:10px">${ctaLabel}</a></div>
<p style="margin:30px 0 0;font-size:13px;color:#6b7280">You are receiving this email because you subscribed to updates from us.</p>
<p style="margin:8px 0 0;font-size:13px"><a href="{{unsubscribe_url}}" style="color:#6b7280">Unsubscribe</a></p>
</td></tr></table></td></tr></table></body></html>`;

export const EMAIL_PRESETS: EmailPreset[] = [
  {
    id: "newsletter",
    name: "Modern Newsletter",
    description: "Editorial layout for weekly updates, company news and curated content.",
    subject: "Your weekly update, {{first_name}}",
    htmlBody: shell("Your weekly update", "Newsletter", `<p>Hi {{first_name}},</p><p>Here is a quick roundup of what is new this week. Use this section for your strongest story, announcement or insight.</p><p><strong>What is inside:</strong></p><ul><li>Top update or story</li><li>Useful resource or article</li><li>Upcoming announcement</li></ul>`, "Read the full update"),
    textBody: "Hi {{first_name}},\n\nHere is your weekly update.\n\n• Top update or story\n• Useful resource or article\n• Upcoming announcement\n\nRead more: https://example.com\n\nUnsubscribe: {{unsubscribe_url}}",
  },
  {
    id: "promotion",
    name: "Product Promotion",
    description: "Clean conversion-focused layout for offers, launches and featured products.",
    subject: "A special offer for you, {{first_name}}",
    htmlBody: shell("Something special for you", "Featured offer", `<p>Hi {{first_name}},</p><p>Highlight your offer here with one clear benefit and one primary action.</p><div style="padding:18px;border-radius:12px;background:#f5f3ff;margin:20px 0"><strong>Main benefit</strong><br><span style="color:#6b7280">Explain why this matters in one or two lines.</span></div>`, "View offer"),
    textBody: "Hi {{first_name}},\n\nWe have something special for you.\n\nMain benefit: Explain the offer clearly here.\n\nView offer: https://example.com\n\nUnsubscribe: {{unsubscribe_url}}",
  },
  {
    id: "announcement",
    name: "Product Announcement",
    description: "Professional launch/update email for features, releases and company announcements.",
    subject: "We have an update to share",
    htmlBody: shell("We have an update to share", "Announcement", `<p>Hi {{first_name}},</p><p>Use this template for a product release, service update or important company announcement.</p><p>Keep the message focused: what changed, why it matters, and what the reader should do next.</p>`, "Learn more"),
    textBody: "Hi {{first_name}},\n\nWe have an update to share.\n\nExplain what changed, why it matters, and what the reader should do next.\n\nLearn more: https://example.com\n\nUnsubscribe: {{unsubscribe_url}}",
  },
  {
    id: "welcome",
    name: "Welcome Email",
    description: "Simple onboarding email for new subscribers, users or customers.",
    subject: "Welcome, {{first_name}} 👋",
    htmlBody: shell("Welcome aboard", "Getting started", `<p>Hi {{first_name}},</p><p>Thanks for joining us. This is a good place to explain what the subscriber can expect and point them to the most useful next step.</p><p>If you ever need help, simply reply to this email.</p>`, "Get started"),
    textBody: "Hi {{first_name}},\n\nWelcome aboard. Thanks for joining us.\n\nUse this message to explain what happens next and point the subscriber to the right resource.\n\nGet started: https://example.com\n\nUnsubscribe: {{unsubscribe_url}}",
  },
];

export function getEmailPreset(id: string) {
  return EMAIL_PRESETS.find((preset) => preset.id === id) || null;
}
