import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { importJobs } from "@/db/schema";
import { importUploads, type ImportMapping, type ImportOptions } from "@/db/import-schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

const MAX_IMPORT_BYTES = 300 * 1024 * 1024;
const IMPORT_UPLOAD_DIR = process.env.IMPORT_UPLOAD_DIR || "/var/lib/neximail/imports";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Import storage is unavailable." }, { status: 503 });

  const body = await request.json().catch(() => null) as {
    filename?: string;
    sizeBytes?: number;
    headers?: string[];
    mapping?: ImportMapping;
    consentSource?: string;
    consentStatus?: string;
    defaultSource?: string;
    defaultCategory?: string;
    defaultTags?: string;
    listId?: string | null;
    queueValidation?: boolean;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid import request." }, { status: 400 });

  const filename = String(body.filename || "").trim().slice(0, 200);
  const sizeBytes = Math.floor(Number(body.sizeBytes || 0));
  if (!filename) return NextResponse.json({ error: "CSV filename is required." }, { status: 400 });
  if (sizeBytes <= 0 || sizeBytes > MAX_IMPORT_BYTES) return NextResponse.json({ error: "CSV must be between 1 byte and 300 MB." }, { status: 413 });

  const headers = Array.isArray(body.headers) ? body.headers.map((value) => String(value).trim()).filter(Boolean).slice(0, 500) : [];
  if (!headers.length) return NextResponse.json({ error: "CSV headers are required." }, { status: 400 });
  const mapping = body.mapping && typeof body.mapping === "object" ? body.mapping : {};
  if (!mapping.email || !headers.includes(mapping.email)) return NextResponse.json({ error: "Map an email column before starting the import." }, { status: 400 });

  const consentSource = String(body.consentSource || "").trim();
  if (!consentSource) return NextResponse.json({ error: "Consent source is required." }, { status: 400 });
  const consentStatus = body.consentStatus === "confirmed" ? "confirmed" : "unconfirmed";
  const defaultSource = String(body.defaultSource || "csv_import").trim() || "csv_import";
  const defaultCategory = String(body.defaultCategory || "").trim();
  const defaultTags = String(body.defaultTags || "").split("|").map((value) => value.trim()).filter(Boolean);
  const listId = String(body.listId || "").trim() || null;
  const queueValidation = body.queueValidation !== false;
  const options: ImportOptions = { consentSource, consentStatus, defaultSource, defaultCategory, defaultTags, listId, queueValidation };

  const createdBy = /^[0-9a-f-]{36}$/i.test(session.userId) ? session.userId : null;
  const [job] = await db.insert(importJobs).values({ filename, status: "pending", totalRows: 0, createdBy }).returning({ id: importJobs.id });
  const storagePath = path.join(IMPORT_UPLOAD_DIR, `${job.id}.csv`);
  await db.insert(importUploads).values({ jobId: job.id, content: "", storagePath, headers, mapping, options, sizeBytes: 0 });
  await db.execute(sql`update import_jobs set source_label=${consentSource}, list_id=${listId} where id=${job.id}`);

  await audit("contact_import.upload_initialized", session, "import_job", job.id, { filename, expectedBytes: sizeBytes, consentSource, listId, queueValidation, mapping });
  return NextResponse.json({ ok: true, jobId: job.id, uploadUrl: `/api/imports/${job.id}/upload`, maxBytes: MAX_IMPORT_BYTES }, { status: 201 });
}
