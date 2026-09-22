export type EmailContentInput = {
  subject: string;
  html: string;
  text: string;
};

function plainText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function emailContentBlockReason(input: EmailContentInput): string | null {
  const subject = input.subject.trim();
  if (!subject) return "subject_missing";
  if (subject.length > 200) return "subject_too_long";

  const html = input.html || "";
  const text = (input.text || "").replace(/\s+/g, " ").trim();
  const visibleHtml = plainText(html);

  if (/<\s*(script|iframe|object|embed|form)\b/i.test(html)) return "unsafe_html_element";
  if (/\b(?:href|src)\s*=\s*["']\s*javascript:/i.test(html)) return "unsafe_link_scheme";

  const hasImage = /<\s*img\b/i.test(html);
  const substantiveText = Math.max(text.length, visibleHtml.length);
  if (hasImage && substantiveText < 40) return "image_only_content";
  if (!text && !visibleHtml) return "body_missing";

  return null;
}
