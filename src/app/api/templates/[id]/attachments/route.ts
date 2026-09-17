import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured, pool } from "@/db";
import { templates } from "@/db/schema";
import { getSession } from "@/lib/auth";
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_CAMPAIGN_ATTACHMENTS,
  MAX_CAMPAIGN_ATTACHMENT_BYTES,
  cleanAttachmentFilename,
  listTemplateAttachments,
} from "@/lib/template-attachments";

async function getTemplate(id: string) {
  const [template] = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
  return template || null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const { id } = await params;
  if (!await getTemplate(id)) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ attachments: await listTemplateAttachments(id) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const { id } = await params;
  if (!await getTemplate(id)) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to attach." }, { status: 400 });
  if (!file.size) return NextResponse.json({ error: "Attachment is empty." }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: `Each attachment must be ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB or smaller.` }, { status: 413 });
  const contentType = (file.type || "application/octet-stream").toLowerCase();
  if (!ALLOWED_ATTACHMENT_TYPES.has(contentType)) return NextResponse.json({ error: "Unsupported attachment type. Use PDF, text/CSV, JPG/PNG/WebP, Word or Excel files." }, { status: 415 });

  const existing = await listTemplateAttachments(id);
  if (existing.length >= MAX_CAMPAIGN_ATTACHMENTS) return NextResponse.json({ error: `A template can contain up to ${MAX_CAMPAIGN_ATTACHMENTS} attachments.` }, { status: 409 });
  const totalBytes = existing.reduce((sum, item) => sum + item.sizeBytes, 0) + file.size;
  if (totalBytes > MAX_CAMPAIGN_ATTACHMENT_BYTES) return NextResponse.json({ error: `Total template attachments must stay under ${Math.floor(MAX_CAMPAIGN_ATTACHMENT_BYTES / 1024 / 1024)} MB.` }, { status: 413 });

  const filename = cleanAttachmentFilename(file.name);
  const content = Buffer.from(await file.arrayBuffer());
  const result = await pool.query(`
    insert into template_attachments (template_id, filename, content_type, size_bytes, content)
    values ($1,$2,$3,$4,$5)
    returning id::text, filename, content_type, size_bytes, created_at
  `, [id, filename, contentType, file.size, content]);
  const row = result.rows[0];
  const attachment = { id: String(row.id), filename: String(row.filename), contentType: String(row.content_type), sizeBytes: Number(row.size_bytes), createdAt: new Date(row.created_at).toISOString() };
  return NextResponse.json({ ok: true, attachment }, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const { id } = await params;
  if (!await getTemplate(id)) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  const body = await request.json().catch(() => null) as { attachmentId?: string } | null;
  const attachmentId = String(body?.attachmentId || "");
  if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return NextResponse.json({ error: "Invalid attachment." }, { status: 400 });
  const result = await pool.query(`delete from template_attachments where id=$1 and template_id=$2 returning filename`, [attachmentId, id]);
  if (!result.rowCount) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
