import { NextResponse } from "next/server";
import { pool, databaseConfigured } from "@/db";
import { audit } from "@/lib/audit";
import { getSession } from "@/lib/auth";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  if (session.role !== "owner" && session.role !== "admin") return NextResponse.json({ error: "Only owners and admins can delete import history." }, { status: 403 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid import id." }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query<{ status: string; validation_job_id: string | null; filename: string }>(
      `select status, validation_job_id, filename from import_jobs where id=$1 for update`, [id],
    );
    const row = found.rows[0];
    if (!row) { await client.query("rollback"); return NextResponse.json({ error: "Import not found." }, { status: 404 }); }
    if (row.status === "pending" || row.status === "processing") { await client.query("rollback"); return NextResponse.json({ error: "Active imports cannot be deleted. Wait for completion or failure." }, { status: 409 }); }

    await client.query(`delete from import_jobs where id=$1`, [id]);
    if (row.validation_job_id) await client.query(`delete from validation_jobs where id=$1`, [row.validation_job_id]);
    await client.query("commit");

    await audit("contact_import.deleted", session, "import_job", id, { filename: row.filename, status: row.status, validationJobId: row.validation_job_id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    console.error("[imports.delete]", error);
    return NextResponse.json({ error: "Failed to delete import history." }, { status: 500 });
  } finally {
    client.release();
  }
}
