import { pool } from "@/db";

export const MAX_CAMPAIGN_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_CAMPAIGN_ATTACHMENT_BYTES = 12 * 1024 * 1024;
export const MAX_COMBINED_ATTACHMENT_BYTES = 12 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export type CampaignAttachmentMeta = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};

export type CampaignAttachment = CampaignAttachmentMeta & { content: Buffer };

export function cleanAttachmentFilename(input: string) {
  const base = input.split(/[\\/]/).pop() || "attachment";
  return base.replace(/[\r\n\0"]/g, "_").slice(0, 180) || "attachment";
}

export function totalAttachmentBytes(attachments: Array<Pick<CampaignAttachmentMeta, "sizeBytes">>) {
  return attachments.reduce((sum, attachment) => sum + Math.max(0, Number(attachment.sizeBytes || 0)), 0);
}

export function combinedAttachmentLimitError(attachments: Array<Pick<CampaignAttachmentMeta, "sizeBytes">>) {
  const total = totalAttachmentBytes(attachments);
  if (total <= MAX_COMBINED_ATTACHMENT_BYTES) return null;
  return `Combined template + campaign attachments are ${(total / 1024 / 1024).toFixed(1)} MB; maximum allowed is ${(MAX_COMBINED_ATTACHMENT_BYTES / 1024 / 1024).toFixed(0)} MB.`;
}

export async function listCampaignAttachments(campaignId: string): Promise<CampaignAttachmentMeta[]> {
  const result = await pool.query(`
    select id::text, filename, content_type, size_bytes, created_at
    from campaign_attachments
    where campaign_id=$1
    order by created_at asc
  `, [campaignId]);
  return result.rows.map((row) => ({
    id: String(row.id), filename: String(row.filename), contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes), createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function loadCampaignAttachments(campaignId: string): Promise<CampaignAttachment[]> {
  const result = await pool.query(`
    select id::text, filename, content_type, size_bytes, content, created_at
    from campaign_attachments
    where campaign_id=$1
    order by created_at asc
  `, [campaignId]);
  return result.rows.map((row) => ({
    id: String(row.id), filename: String(row.filename), contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes), content: Buffer.from(row.content), createdAt: new Date(row.created_at).toISOString(),
  }));
}

export function encodeBase64Mime(buffer: Buffer) {
  const value = buffer.toString("base64");
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}
