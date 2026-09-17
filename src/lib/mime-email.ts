import { encodeBase64Mime, type CampaignAttachment } from "@/lib/campaign-attachments";

function mimeFilename(value: string) {
  return value.replace(/[\r\n\0"\\]/g, "_").slice(0, 180) || "attachment";
}

export function buildMimeContent(params: {
  text: string;
  html: string;
  boundarySeed: string;
  attachments?: CampaignAttachment[];
}) {
  const attachments = params.attachments || [];
  const altBoundary = `neximail_alt_${params.boundarySeed}`;
  const alternative = [
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    params.text || "This message has an HTML version.",
    "",
    `--${altBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    params.html || "<p></p>",
    "",
    `--${altBoundary}--`,
    "",
  ];

  if (!attachments.length) {
    return {
      contentTypeHeader: `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      bodyLines: alternative,
    };
  }

  const mixedBoundary = `neximail_mix_${params.boundarySeed}`;
  const bodyLines = [
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    ...alternative,
  ];

  for (const attachment of attachments) {
    const filename = mimeFilename(attachment.filename);
    bodyLines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.contentType || "application/octet-stream"}; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      encodeBase64Mime(attachment.content),
      "",
    );
  }
  bodyLines.push(`--${mixedBoundary}--`, "");
  return {
    contentTypeHeader: `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    bodyLines,
  };
}
