import { sql } from "drizzle-orm";
import { Database, FileCheck2, FileClock, FileUp, ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ImportWizard } from "@/components/import-wizard";
import { ImportJobActions } from "@/components/import-job-actions";
import { ImportLiveRefresh } from "@/components/import-live-refresh";
import { db, databaseConfigured } from "@/db";
import { importJobs, lists } from "@/db/schema";
import { getSession } from "@/lib/auth";

type ImportJobRow = typeof importJobs.$inferSelect & {
  suppressedRows?: number;
  riskyRows?: number;
  validRows?: number;
  validationInvalidRows?: number;
  sourceLabel?: string | null;
  startedAt?: Date | null;
  validationJobId?: string | null;
};

function speedAndEta(row: ImportJobRow) {
  if (!row.startedAt) return { speed: "—", eta: "Queued" };
  const processed = row.importedRows + row.duplicateRows + row.invalidRows + Number(row.suppressedRows || 0);
  const elapsedMinutes = Math.max((Date.now() - new Date(row.startedAt).getTime()) / 60000, 1 / 60);
  const rpm = processed / elapsedMinutes;
  if (!Number.isFinite(rpm) || rpm <= 0) return { speed: "Starting…", eta: "Calculating…" };
  const remaining = Math.max(0, row.totalRows - processed);
  const etaMinutes = remaining / rpm;
  return {
    speed: `${rpm >= 1000 ? `${(rpm / 1000).toFixed(1)}k` : Math.round(rpm).toLocaleString()}/min`,
    eta: row.status === "completed" ? "Done" : etaMinutes < 1 ? "<1m" : etaMinutes < 60 ? `${Math.ceil(etaMinutes)}m` : `${(etaMinutes / 60).toFixed(1)}h`,
  };
}

export default async function ImportsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let rows: ImportJobRow[] = [];
  let listRows: { id: string; name: string }[] = [];
  let dbError = false;

  if (databaseConfigured) {
    try {
      rows = (await db.execute(sql`
        select
          id,
          filename,
          status,
          total_rows as "totalRows",
          imported_rows as "importedRows",
          duplicate_rows as "duplicateRows",
          invalid_rows as "invalidRows",
          coalesce(suppressed_rows, 0)::int as "suppressedRows",
          coalesce(risky_rows, 0)::int as "riskyRows",
          coalesce(valid_rows, 0)::int as "validRows",
          coalesce(validation_invalid_rows, 0)::int as "validationInvalidRows",
          source_label as "sourceLabel",
          validation_job_id as "validationJobId",
          started_at as "startedAt",
          error_message as "errorMessage",
          created_by as "createdBy",
          created_at as "createdAt",
          completed_at as "completedAt"
        from import_jobs
        order by created_at desc
        limit 100
      `)).rows as unknown as ImportJobRow[];

      listRows = await db.select({ id: lists.id, name: lists.name }).from(lists).orderBy(lists.name);
    } catch (error) {
      console.error("[imports-page] failed to load import workspace", error);
      dbError = true;
    }
  }

  const usable = databaseConfigured && !dbError;
  const active = rows.filter((row) => row.status === "pending" || row.status === "processing").length;
  const processed = rows.reduce((sum, row) => sum + (row.status === "completed" ? row.totalRows : row.importedRows + row.duplicateRows + row.invalidRows + Number(row.suppressedRows || 0)), 0);
  const accepted = rows.reduce((sum, row) => sum + Number(row.validRows || 0), 0);
  const rejected = rows.reduce((sum, row) => sum + row.invalidRows + Number(row.validationInvalidRows || 0) + Number(row.suppressedRows || 0), 0);
  const kpis = [
    { label: "Active jobs", value: active, icon: FileClock },
    { label: "Rows processed", value: processed, icon: Database },
    { label: "Validated / accepted", value: accepted, icon: FileCheck2 },
    { label: "Non-valid / suppressed", value: rejected, icon: ShieldAlert },
  ];

  return <AppShell session={session}>
    <ImportLiveRefresh active={active > 0} />
    <div className="mb-5"><p className="page-eyebrow mb-2">Audience operations</p><h1 className="page-title">Imports</h1><p className="page-description">Upload up to 1,000,000 contacts in one CSV job with field mapping, source/tags/category assignment, custom fields, scoped background validation and live progress.</p></div>

    {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Import engine unavailable.</b> Check the database connection.</div> : null}

    <details className="premium-panel mb-4 overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5"><div><h2 className="text-sm font-black">CSV format & import guide</h2><p className="mt-0.5 text-[10.5px] text-[var(--muted)]">Required header rules, mapping and capacity details</p></div><span className="status-pill">View guide</span></summary>
      <div className="border-t border-[var(--border)] p-4">
        <div className="grid gap-2.5 text-xs md:grid-cols-2">
          <p><b>1.</b> Email is mandatory. EMAILID, EMAIL_ID and E-MAIL aliases are auto-detected.</p>
          <p><b>2.</b> Use <code>|</code> for multiple categories/tags, for example <code>Students|NEET</code>.</p>
          <p><b>3.</b> Select a consent source, optional list, default source/category and tags.</p>
          <p><b>4.</b> Unmapped columns stay available as custom personalization fields.</p>
        </div>
        <div className="mt-3 rounded-xl bg-[var(--surface-soft)] p-3 text-[10.5px] text-[var(--muted)]"><b>Recommended header:</b> <code className="break-all">email,name,first_name,last_name,phone,dob,gender,state,district,city,pincode,occupation,industry,audience_type,category,categories,tags,source</code></div>
        <div className="mt-2 text-[10.5px] text-[var(--muted)]"><b>Capacity:</b> up to 1,000,000 rows / 300 MB. Active jobs refresh every 4 seconds.</div>
      </div>
    </details>

    {usable ? <ImportWizard lists={listRows} /> : null}

    <section className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{kpis.map(({ label, value, icon: Icon }) => <article key={label} className="compact-stat"><div className="flex items-start justify-between gap-4"><div><p className="compact-stat-label">{label}</p><p className="compact-stat-value">{value.toLocaleString()}</p></div><div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Icon className="h-4.5 w-4.5" /></div></div></article>)}</section>

    <section className="premium-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3.5"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">History</p><h2 className="mt-1 text-lg font-black">Import jobs</h2><p className="mt-1 text-xs text-[var(--muted)]">Completed/failed job metadata is retained for 30 days. Active jobs are never cleaned.</p></div><FileUp className="h-5 w-5 text-[var(--muted)]" /></div>
      {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-xs"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[0.13em] text-[var(--muted)]"><tr><th className="px-4 py-3">File / consent</th><th>Status</th><th>Progress</th><th>Accepted</th><th>Risky</th><th>Invalid</th><th>Dup / Supp</th><th>Speed</th><th>ETA</th><th>Created</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => { const suppressed = Number(row.suppressedRows || 0); const validationInvalid = Number(row.validationInvalidRows || 0); const accounted = row.importedRows + row.duplicateRows + row.invalidRows + suppressed; const done = row.status === "completed" ? row.totalRows : accounted; const progress = row.status === "completed" ? 100 : row.totalRows ? Math.min(100, Math.round((accounted / row.totalRows) * 100)) : 0; const perf=speedAndEta(row); return <tr key={row.id} className="border-t border-[var(--border)] align-top"><td className="px-5 py-4"><p className="font-extrabold">{row.filename}</p><p className="mt-1 text-xs text-[var(--muted)]">{row.sourceLabel || "—"}</p>{row.errorMessage ? <p className="mt-1 max-w-md truncate text-xs text-rose-500">{row.errorMessage}</p> : null}</td><td><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${row.status === "completed" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : row.status === "failed" ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{row.status}</span></td><td className="pr-6"><div className="h-2 w-40 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-violet-500 transition-[width] duration-500" style={{ width: `${progress}%` }} /></div><p className="mt-1 text-[10px] font-bold text-[var(--muted)]">{progress}% · {done.toLocaleString()} / {row.totalRows.toLocaleString()}</p></td><td className="font-bold text-emerald-600">{Number(row.validRows || 0).toLocaleString()}</td><td className="font-bold text-amber-600">{Number(row.riskyRows || 0).toLocaleString()}</td><td>{(row.invalidRows + validationInvalid).toLocaleString()}</td><td>{row.duplicateRows.toLocaleString()} / {suppressed.toLocaleString()}</td><td className="text-xs font-bold text-[var(--muted)]">{perf.speed}</td><td className="text-xs font-bold text-[var(--muted)]">{perf.eta}</td><td className="text-xs text-[var(--muted)]">{new Intl.DateTimeFormat("en",{dateStyle: "medium", timeStyle: "short", timeZone:"Asia/Kolkata"}).format(new Date(row.createdAt))}</td><td className="pr-5"><ImportJobActions id={row.id} deletable={(session.role === "owner" || session.role === "admin") && row.status !== "pending" && row.status !== "processing"} /></td></tr>; })}</tbody></table></div> : <div className="grid min-h-64 place-items-center p-8 text-center"><div><FileUp className="mx-auto h-8 w-8 text-[var(--muted)]" /><h3 className="mt-4 font-black">No import jobs yet</h3><p className="mt-1 text-sm text-[var(--muted)]">Upload a CSV to start a background import.</p></div></div>}
    </section>
  </AppShell>;
}
