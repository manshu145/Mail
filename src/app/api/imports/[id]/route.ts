import { unlink } from "node:fs/promises";
import { NextResponse } from "next/server";
import { pool, databaseConfigured } from "@/db";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid import id." }, { status: 400 });

  const client = await pool.connect();
  let storagePath: string | null = null;
  try {
    await client.query("begin");
    const found = await client.query<{ status: string; validation_job_id: string | null; filename: string; storage_path: string | null; size_bytes: number; created_by: string | null }>(
      `select j.status, j.validation_job_id, j.filename, u.storage_path, coalesce(u.size_bytes,0)::int as size_bytes, j.created_by
       from import_jobs j
       left join import_uploads u on u.job_id=j.id
       where j.id=$1
       for update of j`, [id],
    );
    const row = found.rows[0];
    if (!row) { await client.query("rollback"); return NextResponse.json({ error: "Import not found." }, { status: 404 }); }
    const privileged = session.role === "owner" || session.role === "admin";
    const ownEmptyUpload = row.status === "pending" && Number(row.size_bytes || 0) === 0 && row.created_by === session.userId;
    if (!privileged && !ownEmptyUpload) { await client.query("rollback"); return NextResponse.json({ error: "Only owners/admins can delete import history. You may only cancel your own upload before file transfer completes." }, { status: 403 }); }
    if (row.status === "processing" || (row.status === "pending" && !ownEmptyUpload)) { await client.query("rollback"); return NextResponse.json({ error: "Active imports cannot be deleted after upload starts processing." }, { status: 409 }); }

    storagePath = row.storage_path;
    await client.query(`delete from import_jobs where id=$1`, [id]);
    if (row.validation_job_id) await client.query(`delete from validation_jobs where id=$1`, [row.validation_job_id]);
    await client.query("commit");

    if (storagePath) await unlink(storagePath).catch((error) => console.error("[imports.delete-spool]", error));
    await audit("contact_import.deleted", session, "import_job", id, { filename: row.filename, status: row.status, validationJobId: row.validation_job_id, diskSpoolDeleted: Boolean(storagePath) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    console.error("[imports.delete]", error);
    return NextResponse.json({ error: "Failed to delete import history." }, { status: 500 });
  } finally {
    client.release();
  }
}
