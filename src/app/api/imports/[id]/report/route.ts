import { NextResponse } from "next/server";
import { pool, databaseConfigured } from "@/db";
import { getSession } from "@/lib/auth";

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!databaseConfigured) return NextResponse.json({ error: "Database unavailable." }, { status: 503 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid import id." }, { status: 400 });

  const job = await pool.query<{ filename: string; validation_job_id: string | null }>(
    `select filename, validation_job_id from import_jobs where id=$1`, [id],
  );
  if (!job.rows[0]) return NextResponse.json({ error: "Import not found." }, { status: 404 });

  const result = await pool.query<{
    row_number: number;
    email: string | null;
    import_result: string | null;
    import_detail: string | null;
    validation_status: string | null;
    validation_detail: string | null;
  }>(`
    select
      s.row_number,
      nullif(s.payload->>'email','') as email,
      s.result as import_result,
      s.detail as import_detail,
      vr.status::text as validation_status,
      vr.detail as validation_detail
    from import_staging_rows s
    left join validation_results vr
      on vr.job_id=$2 and vr.contact_id=s.contact_id
    where s.job_id=$1
    order by s.row_number asc
  `, [id, job.rows[0].validation_job_id]);

  const lines = [
    ["row","email","import_result","import_detail","validation_status","validation_detail"].map(csvCell).join(","),
    ...result.rows.map((row) => [row.row_number,row.email,row.import_result,row.import_detail,row.validation_status,row.validation_detail].map(csvCell).join(",")),
  ];
  const safeName = job.rows[0].filename.replace(/[^a-z0-9._-]+/gi, "_").replace(/\.csv$/i, "") || "import";

  return new NextResponse(lines.join("\r\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}-report.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
