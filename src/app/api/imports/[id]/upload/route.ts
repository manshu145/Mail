import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { importJobs } from "@/db/schema";
import { importUploads } from "@/db/import-schema";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_IMPORT_BYTES = 300 * 1024 * 1024;
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;
const IMPORT_UPLOAD_DIR = process.env.IMPORT_UPLOAD_DIR || "/var/lib/neximail/imports";

function storageMessage(error: unknown) {
  const reason = error instanceof Error ? error.message : "upload_failed";
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const message =
    reason === "import_too_large" ? "CSV is larger than 300 MB." :
    reason === "empty_import" ? "CSV upload was empty." :
    reason === "chunk_too_large" ? "CSV upload chunk is too large. Refresh the page and retry with the current NexiMail uploader." :
    reason === "offset_mismatch" ? "CSV upload became out of sequence. Refresh the page and retry the import." :
    reason === "size_mismatch" ? "CSV upload ended before all bytes arrived. Retry the import." :
    code === "EACCES" || code === "EPERM" ? "CSV storage is not writable on the server. An administrator must repair the import volume permissions." :
    code === "ENOSPC" ? "CSV upload could not be saved because the server disk is full." :
    code === "EROFS" ? "CSV storage is mounted read-only on the server." :
    "CSV upload failed while writing the file to server storage. Retry once; if it fails again, check the import job error or server storage.";
  return { reason, code, message };
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Import storage is unavailable." }, { status: 503 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid import id." }, { status: 400 });
  if (!request.body) return NextResponse.json({ error: "CSV upload body is empty." }, { status: 400 });

  const [job] = await db.select({ id: importJobs.id, status: importJobs.status, filename: importJobs.filename }).from(importJobs).where(eq(importJobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ error: "Import not found." }, { status: 404 });
  if (job.status !== "pending") return NextResponse.json({ error: "This import is no longer accepting an upload." }, { status: 409 });

  const [upload] = await db.select().from(importUploads).where(eq(importUploads.jobId, id)).limit(1);
  if (!upload) return NextResponse.json({ error: "Import upload metadata is missing." }, { status: 409 });
  if (upload.sizeBytes > 0) return NextResponse.json({ error: "CSV upload is already complete.", bytes: upload.sizeBytes }, { status: 409 });

  const offsetHeader = request.headers.get("x-neximail-upload-offset");
  const totalHeader = request.headers.get("x-neximail-upload-total");
  const chunked = offsetHeader !== null || totalHeader !== null;
  const declared = Number(request.headers.get("content-length") || 0);

  let offset = 0;
  let expectedTotal = declared;
  let finalChunk = true;

  if (chunked) {
    offset = Number(offsetHeader);
    expectedTotal = Number(totalHeader);
    finalChunk = request.headers.get("x-neximail-upload-final") === "1";
    if (!Number.isInteger(offset) || offset < 0) return NextResponse.json({ error: "Invalid CSV upload offset.", code: "invalid_offset" }, { status: 400 });
    if (!Number.isInteger(expectedTotal) || expectedTotal <= 0 || expectedTotal > MAX_IMPORT_BYTES) return NextResponse.json({ error: "CSV must be between 1 byte and 300 MB.", code: "invalid_total" }, { status: 413 });
    if (declared > MAX_CHUNK_BYTES) return NextResponse.json({ error: "CSV upload chunk is too large. Refresh and retry.", code: "chunk_too_large" }, { status: 413 });
  } else if (declared > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "CSV is larger than 300 MB." }, { status: 413 });
  }

  await mkdir(IMPORT_UPLOAD_DIR, { recursive: true });
  const storagePath = upload.storagePath || path.join(IMPORT_UPLOAD_DIR, `${id}.csv`);
  const tempPath = `${storagePath}.part`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;

  try {
    if (offset === 0) {
      await unlink(tempPath).catch(() => {});
    } else {
      const existing = await stat(tempPath).catch(() => null);
      if (!existing || existing.size !== offset) throw new Error("offset_mismatch");
    }

    handle = await open(tempPath, offset === 0 ? "wx" : "a", 0o600);
    const reader = request.body.getReader();
    let chunkBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      chunkBytes += value.byteLength;
      if (chunked && chunkBytes > MAX_CHUNK_BYTES) throw new Error("chunk_too_large");
      if (offset + chunkBytes > MAX_IMPORT_BYTES || (chunked && offset + chunkBytes > expectedTotal)) throw new Error("import_too_large");
      await handle.write(Buffer.from(value));
    }

    await handle.sync();
    await handle.close();
    handle = null;

    if (!chunkBytes && offset === 0) throw new Error("empty_import");
    const nextOffset = offset + chunkBytes;

    if (!finalChunk) {
      return NextResponse.json({ ok: true, partial: true, jobId: id, nextOffset }, { status: 202 });
    }

    if (chunked && nextOffset !== expectedTotal) throw new Error("size_mismatch");
    if (!chunked && !nextOffset) throw new Error("empty_import");

    await rename(tempPath, storagePath);
    await db.update(importUploads).set({ storagePath, sizeBytes: nextOffset }).where(eq(importUploads.jobId, id));
    await audit("contact_import.queued", session, "import_job", id, { filename: job.filename, bytes: nextOffset, storage: "disk_spool", chunked });
    return NextResponse.json({ ok: true, queued: true, jobId: id, bytes: nextOffset, nextOffset }, { status: 202 });
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    const detail = storageMessage(error);
    const fatalStorage = ["EACCES","EPERM","ENOSPC","EROFS"].includes(detail.code);
    if (fatalStorage) await db.update(importJobs).set({ status: "failed", errorMessage: detail.message }).where(eq(importJobs.id, id)).catch(() => {});
    console.error("[imports.upload]", { jobId: id, code: detail.code, reason: detail.reason, chunked, offset, expectedTotal, error });

    const status =
      detail.reason === "import_too_large" || detail.reason === "chunk_too_large" ? 413 :
      detail.reason === "empty_import" || detail.reason === "size_mismatch" ? 400 :
      detail.reason === "offset_mismatch" ? 409 :
      detail.code === "ENOSPC" ? 507 : 500;
    return NextResponse.json({ error: detail.message, code: detail.reason || detail.code || "storage_write_failed" }, { status });
  }
}
