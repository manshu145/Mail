import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { importJobs, lists } from "@/db/schema";
import { importUploads, type ImportMapping, type ImportOptions } from "@/db/import-schema";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { detectMapping, iterateCsvRows } from "@/lib/csv-import";

const MAX_IMPORT_BYTES = 300 * 1024 * 1024;
const MAX_IMPORT_ROWS = 1_000_000;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Import storage is unavailable." }, { status: 503 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a CSV file." }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_IMPORT_BYTES) return NextResponse.json({ error: "CSV must be between 1 byte and 300 MB." }, { status: 413 });

  const consentSource = String(form.get("consentSource") || "").trim();
  if (!consentSource) return NextResponse.json({ error: "Consent source is required." }, { status: 400 });

  const consentStatus = String(form.get("consentStatus") || "unconfirmed") === "confirmed" ? "confirmed" : "unconfirmed";
  const defaultSource = String(form.get("defaultSource") || "csv_import").trim() || "csv_import";
  const defaultCategory = String(form.get("defaultCategory") || "").trim();
  const defaultTags = String(form.get("defaultTags") || "").split("|").map((v) => v.trim()).filter(Boolean);
  const listId = String(form.get("listId") || "").trim() || null;
  const queueValidation = String(form.get("queueValidation") || "true") !== "false";

  if (listId) {
    if (!/^[0-9a-f-]{36}$/i.test(listId)) return NextResponse.json({ error: "Selected list id is invalid." }, { status: 400 });
    const [list] = await db.select({ id: lists.id }).from(lists).where(eq(lists.id, listId)).limit(1);
    if (!list) return NextResponse.json({ error: "Selected list no longer exists. Refresh and choose another list." }, { status: 409 });
  }

  const content = await file.text();
  let headers: string[] | null = null;
  let totalRows = 0;
  for (const row of iterateCsvRows(content)) {
    if (!headers) { headers = row.map((h) => h.trim()); continue; }
    if (!row.some((cell) => cell.trim())) continue;
    totalRows++;
    if (totalRows > MAX_IMPORT_ROWS) return NextResponse.json({ error: "A single import can contain up to 1,000,000 data rows." }, { status: 413 });
  }
  if (!headers || !headers.length || totalRows < 1) return NextResponse.json({ error: "CSV must include a header and at least one data row." }, { status: 400 });

  const providedMapping = String(form.get("mapping") || "").trim();
  let mapping: ImportMapping;
  try { mapping = providedMapping ? JSON.parse(providedMapping) as ImportMapping : detectMapping(headers); }
  catch { return NextResponse.json({ error: "Column mapping is invalid." }, { status: 400 }); }
  if (!mapping.email || !headers.includes(mapping.email)) return NextResponse.json({ error: "Map an email column before starting the import." }, { status: 400 });

  const options: ImportOptions = { consentSource, consentStatus, defaultSource, defaultCategory, defaultTags, listId, queueValidation };
  const createdBy = /^[0-9a-f-]{36}$/i.test(session.userId) ? session.userId : null;

  const jobId = await db.transaction(async (tx) => {
    const [job] = await tx.insert(importJobs).values({ filename: file.name.slice(0, 200), status: "pending", totalRows, createdBy }).returning({ id: importJobs.id });
    await tx.insert(importUploads).values({ jobId: job.id, content, headers, mapping, options, sizeBytes: file.size });
    await tx.execute(sql`update import_jobs set source_label=${consentSource}, list_id=${listId} where id=${job.id}`);
    return job.id;
  });

  await audit("contact_import.queued", session, "import_job", jobId, { filename: file.name, total: totalRows, consentSource, listId, queueValidation, mapping });
  return NextResponse.json({ ok: true, queued: true, jobId, total: totalRows }, { status: 202 });
}
