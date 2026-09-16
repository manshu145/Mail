import { desc } from "drizzle-orm";
import { Database, FileCheck2, FileClock, FileUp, ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ContactsActions } from "@/components/contacts-actions";
import { db, databaseConfigured } from "@/db";
import { importJobs } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function ImportsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let rows: typeof importJobs.$inferSelect[] = [];
  let dbError = false;
  if (databaseConfigured) {
    try { rows = await db.select().from(importJobs).orderBy(desc(importJobs.createdAt)).limit(100); }
    catch { dbError = true; }
  }
  const usable = databaseConfigured && !dbError;
  const active = rows.filter((row) => row.status === "pending" || row.status === "processing").length;
  const processed = rows.reduce((sum, row) => sum + (row.status === "completed" ? row.totalRows : row.importedRows + row.duplicateRows + row.invalidRows), 0);
  const imported = rows.reduce((sum, row) => sum + row.importedRows, 0);
  const rejected = rows.reduce((sum, row) => sum + row.invalidRows, 0);
  const kpis = [
    { label: "Active jobs", value: active, icon: FileClock },
    { label: "Rows processed", value: processed, icon: Database },
    { label: "Imported", value: imported, icon: FileCheck2 },
    { label: "Invalid", value: rejected, icon: ShieldAlert },
  ];

  return (
    <AppShell session={session}>
      <div className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="page-eyebrow mb-2">Audience operations</p><h1 className="page-title">Imports</h1><p className="page-description">Queue CSV contact imports, watch background progress and review every result without blocking the web request.</p></div>
        <ContactsActions databaseConfigured={usable} />
      </div>

      {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Import engine unavailable.</b> Check the database connection.</div> : null}

      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{kpis.map(({ label, value, icon: Icon }) => <article key={label} className="metric-card p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-[12px] font-extrabold text-[var(--muted)]">{label}</p><p className="mt-3 text-3xl font-black tracking-[-0.04em]">{value.toLocaleString()}</p></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Icon className="h-4.5 w-4.5" /></div></div></article>)}</section>

      <section className="premium-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4 sm:px-6"><div><p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">History</p><h2 className="mt-1 text-lg font-black">Import jobs</h2></div><FileUp className="h-5 w-5 text-[var(--muted)]" /></div>
        {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[0.13em] text-[var(--muted)]"><tr><th className="px-5 py-3.5">File</th><th>Status</th><th>Progress</th><th>Imported</th><th>Duplicates</th><th>Invalid</th><th>Created</th></tr></thead><tbody>{rows.map((row) => { const accounted = row.importedRows + row.duplicateRows + row.invalidRows; const done = row.status === "completed" ? row.totalRows : accounted; const progress = row.status === "completed" ? 100 : row.totalRows ? Math.min(100, Math.round((accounted / row.totalRows) * 100)) : 0; return <tr key={row.id} className="border-t border-[var(--border)]"><td className="px-5 py-4"><p className="font-extrabold">{row.filename}</p>{row.errorMessage ? <p className="mt-1 max-w-md truncate text-xs text-rose-500">{row.errorMessage}</p> : null}</td><td><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${row.status === "completed" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : row.status === "failed" ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{row.status}</span></td><td className="pr-6"><div className="h-1.5 w-32 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-violet-500" style={{ width: `${progress}%` }} /></div><p className="mt-1 text-[10px] font-bold text-[var(--muted)]">{progress}% · {done.toLocaleString()} / {row.totalRows.toLocaleString()}</p></td><td className="font-bold text-emerald-600">{row.importedRows.toLocaleString()}</td><td>{row.duplicateRows.toLocaleString()}</td><td>{row.invalidRows.toLocaleString()}</td><td className="text-xs text-[var(--muted)]">{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(row.createdAt)}</td></tr>; })}</tbody></table></div> : <div className="grid min-h-64 place-items-center p-8 text-center"><div><FileUp className="mx-auto h-8 w-8 text-[var(--muted)]" /><h3 className="mt-4 font-black">No import jobs yet</h3><p className="mt-1 text-sm text-[var(--muted)]">Upload a CSV to start a background import.</p></div></div>}
      </section>
    </AppShell>
  );
}
