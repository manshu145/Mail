import { pool } from "@/db";
import { MAX_ATTACHMENT_BYTES, MAX_CAMPAIGN_ATTACHMENTS, MAX_CAMPAIGN_ATTACHMENT_BYTES, ALLOWED_ATTACHMENT_TYPES, cleanAttachmentFilename, type CampaignAttachment } from "@/lib/campaign-attachments";

export { MAX_ATTACHMENT_BYTES, MAX_CAMPAIGN_ATTACHMENTS, MAX_CAMPAIGN_ATTACHMENT_BYTES, ALLOWED_ATTACHMENT_TYPES, cleanAttachmentFilename };

export type TemplateAttachmentMeta = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};

export async function listTemplateAttachments(templateId: string): Promise<TemplateAttachmentMeta[]> {
  const result = await pool.query(`
    select id::text, filename, content_type, size_bytes, created_at
    from template_attachments
    where template_id=$1
    order by created_at asc
  `, [templateId]);
  return result.rows.map((row) => ({
    id: String(row.id), filename: String(row.filename), contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes), createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function loadTemplateAttachments(templateId: string): Promise<CampaignAttachment[]> {
  const result = await pool.query(`
    select id::text, filename, content_type, size_bytes, content, created_at
    from template_attachments
    where template_id=$1
    order by created_at asc
  `, [templateId]);
  return result.rows.map((row) => ({
    id: String(row.id), filename: String(row.filename), contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes), content: Buffer.from(row.content), createdAt: new Date(row.created_at).toISOString(),
  }));
}
