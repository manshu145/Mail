export type PreflightLevel = "ready" | "warning" | "blocked";

export type ContentFinding = {
  code: string;
  level: Exclude<PreflightLevel, "ready">;
  message: string;
};

export type ContentPreflightResult = {
  status: PreflightLevel;
  risk: "low" | "medium" | "high";
  score: number;
  findings: ContentFinding[];
  linkCount: number;
};

const SHORTENER_HOSTS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "buff.ly", "rebrand.ly", "cutt.ly", "shorturl.at",
]);
const DANGEROUS_EXTENSIONS = /\.(?:exe|scr|js|jse|vbs|vbe|bat|cmd|com|msi|ps1|jar|iso|img)(?:$|[?#])/i;

function host(value: string) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function visibleText(html: string) {
  return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scanCampaignContent(input: {
  subject?: string | null;
  html?: string | null;
  text?: string | null;
  fromEmail?: string | null;
  attachmentNames?: string[];
}): ContentPreflightResult {
  const subject = String(input.subject || "").trim();
  const html = String(input.html || "");
  const text = String(input.text || "").trim();
  const findings: ContentFinding[] = [];
  const add = (code: string, level: ContentFinding["level"], message: string) => findings.push({ code, level, message });

  if (!subject) add("subject_missing", "blocked", "Subject is required before delivery.");
  if (!html.trim() && !text) add("body_missing", "blocked", "The campaign has no message body.");
  if (!text) add("plain_text_missing", "warning", "Add a plain-text version for clients that do not render HTML.");
  if (/\b(?:re|fwd):/i.test(subject) || /(?:urgent action|required immediately|account suspended)/i.test(subject)) {
    add("deceptive_subject_risk", "warning", "Subject wording may look deceptive or unnecessarily urgent.");
  }
  if (/<script\b|javascript:|data:text\/html/i.test(html)) add("unsafe_html", "blocked", "Remove scripts or executable URLs from the email HTML.");

  const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ url: match[1].trim(), label: visibleText(match[2]) }));
  const httpLinks = links.filter((link) => /^https?:\/\//i.test(link.url));
  const shortened = httpLinks.filter((link) => SHORTENER_HOSTS.has(host(link.url)));
  if (shortened.length) add("shortened_urls", "warning", `${shortened.length} shortened URL${shortened.length === 1 ? "" : "s"} hide the final destination.`);
  if (httpLinks.some((link) => DANGEROUS_EXTENSIONS.test(link.url))) add("dangerous_download", "blocked", "A link points to a potentially dangerous executable file.");

  const mismatched = httpLinks.filter((link) => {
    if (!/^https?:\/\//i.test(link.label)) return false;
    return host(link.label) !== host(link.url);
  });
  if (mismatched.length) add("mismatched_link_text", "blocked", "Visible link text does not match its actual destination.");

  const senderDomain = String(input.fromEmail || "").split("@")[1]?.toLowerCase() || "";
  const destinationHosts = new Set(httpLinks.map((link) => host(link.url)).filter(Boolean));
  if (senderDomain && destinationHosts.size && ![...destinationHosts].some((value) => value === senderDomain || value.endsWith(`.${senderDomain}`))) {
    add("sender_link_domain_mismatch", "warning", "CTA domains do not match the sender domain; verify that every destination is expected.");
  }

  const words = `${visibleText(html)} ${text}`.trim().split(/\s+/).filter(Boolean).length;
  if (httpLinks.length >= 5 && words > 0 && httpLinks.length / words > 0.08) add("high_link_density", "warning", "The message has a high link-to-text ratio.");
  if (!/unsubscribe/i.test(`${html} ${text}`)) add("unsubscribe_injected", "warning", "No unsubscribe token is present in the template; NexiMail will inject the required footer and headers.");

  const dangerousAttachments = (input.attachmentNames || []).filter((name) => DANGEROUS_EXTENSIONS.test(name));
  if (dangerousAttachments.length) add("dangerous_attachment", "blocked", "Remove executable or script attachments before sending.");

  const score = Math.min(100, findings.reduce((sum, finding) => sum + (finding.level === "blocked" ? 40 : 12), 0));
  const status: PreflightLevel = findings.some((finding) => finding.level === "blocked") ? "blocked" : findings.length ? "warning" : "ready";
  return { status, risk: score >= 40 ? "high" : score >= 12 ? "medium" : "low", score, findings, linkCount: httpLinks.length };
}
