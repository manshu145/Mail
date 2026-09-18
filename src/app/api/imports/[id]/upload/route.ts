import { mkdir, open, rename, unlink } from "node:fs/promises";
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
const IMPORT_UPLOAD_DIR = process.env.IMPORT_UPLOAD_DIR || "/var/lib/neximail/imports";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Import storage is unavailable." }, { status: 503 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid import id." }, { status: 400 });
  if (!request.body) return NextResponse.json({ error: "CSV upload body is empty." }, { status: 400 });

  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_IMPORT_BYTES) return NextResponse.json({ error: "CSV is larger than 300 MB." }, { status: 413 });

  const [job] = await db.select({ id: importJobs.id, status: importJobs.status, filename: importJobs.filename }).from(importJobs).where(eq(importJobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ error: "Import not found." }, { status: 404 });
  if (job.status !== "pending") return NextResponse.json({ error: "This import is no longer accepting an upload." }, { status: 409 });

  const [upload] = await db.select().from(importUploads).where(eq(importUploads.jobId, id)).limit(1);
  if (!upload) return NextResponse.json({ error: "Import upload metadata is missing." }, { status: 409 });
  if (upload.sizeBytes > 0) return NextResponse.json({ error: "CSV upload is already complete." }, { status: 409 });

  await mkdir(IMPORT_UPLOAD_DIR, { recursive: true });
  const storagePath = upload.storagePath || path.join(IMPORT_UPLOAD_DIR, `${id}.csv`);
  const tempPath = `${storagePath}.part`;
  await unlink(tempPath).catch(() => {});

  let bytes = 0;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tempPath, "wx", 0o600);
    const reader = request.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      bytes += value.byteLength;
      if (bytes > MAX_IMPORT_BYTES) throw new Error("import_too_large");
      await handle.write(Buffer.from(value));
    }
    await handle.sync();
    await handle.close();
    handle = null;
    if (!bytes) throw new Error("empty_import");

    await rename(tempPath, storagePath);
    await db.update(importUploads).set({ storagePath, sizeBytes: bytes }).where(eq(importUploads.jobId, id));
    await audit("contact_import.queued", session, "import_job", id, { filename: job.filename, bytes, storage: "disk_spool" });
    return NextResponse.json({ ok: true, queued: true, jobId: id, bytes }, { status: 202 });
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    const reason = error instanceof Error ? error.message : "upload_failed";
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
    const userMessage =
      reason === "import_too_large" ? "CSV is larger than 300 MB." :
      reason === "empty_import" ? "CSV upload was empty." :
      code === "EACCES" || code === "EPERM" ? "CSV storage is not writable on the server. An administrator must repair the import volume permissions." :
      code === "ENOSPC" ? "CSV upload could not be saved because the server disk is full." :
      code === "EROFS" ? "CSV storage is mounted read-only on the server." :
      "CSV upload failed while writing the file to server storage. Please retry once; if it fails again, check the import job error or server storage.";

    await db.update(importJobs).set({ status: "failed", errorMessage: userMessage }).where(eq(importJobs.id, id)).catch(() => {});
    console.error("[imports.upload]", { jobId: id, code, reason, error });
    if (reason === "import_too_large") return NextResponse.json({ error: userMessage, code: "file_too_large" }, { status: 413 });
    if (reason === "empty_import") return NextResponse.json({ error: userMessage, code: "empty_file" }, { status: 400 });
    if (code === "EACCES" || code === "EPERM") return NextResponse.json({ error: userMessage, code: "storage_permission" }, { status: 500 });
    if (code === "ENOSPC") return NextResponse.json({ error: userMessage, code: "storage_full" }, { status: 507 });
    if (code === "EROFS") return NextResponse.json({ error: userMessage, code: "storage_read_only" }, { status: 500 });
    return NextResponse.json({ error: userMessage, code: "storage_write_failed" }, { status: 500 });
  }
}
