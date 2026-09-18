import { desc, eq, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ValidationControls } from "@/components/validation-controls";
import { db, databaseConfigured, pool } from "@/db";
import { contacts, importJobs, systemSettings, validationJobs, validationResults } from "@/db/schema";
import { getSession } from "@/lib/auth";

const gmailScope = sql`lower(${contacts.normalizedEmail}) ~ '@(gmail|googlemail)\\.com$'`;

function resultClass(status: string) {
  if (status === "accepted" || status === "valid") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "invalid") return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (status === "pending") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-orange-500/10 text-orange-700 dark:text-orange-300";
}

export default async function ValidationPage() {
  const session = await getSession(); if (!session) redirect("/login");

  let jobs: typeof validationJobs.$inferSelect[] = [];
  let results: typeof validationResults.$inferSelect[] = [];
  let gmail = 0, accepted = 0, invalid = 0, unresolved = 0;
  let paused = false;
  let activeJob: typeof validationJobs.$inferSelect | null = null;
  let imports: Array<{ id: string; filename: string; unresolved: number }> = [];
  let dbError = false;

  if (databaseConfigured) {
    try {
      const [jobRows, resultRows, gmailRows, acceptedRows, invalidRows, unresolvedRows, pauseRows, activeRows, importRows] = await Promise.all([
        db.select().from(validationJobs).orderBy(desc(validationJobs.createdAt)).limit(30),
        db.select().from(validationResults).orderBy(desc(validationResults.createdAt)).limit(80),
        db.select({value:sql<number>`count(*)::int`}).from(contacts).where(gmailScope),
        db.select({value:sql<number>`count(*)::int`}).from(contacts).where(sql`${gmailScope} and ${contacts.validationStatus} in ('accepted','valid')`),
        db.select({value:sql<number>`count(*)::int`}).from(contacts).where(sql`${gmailScope} and ${contacts.validationStatus}='invalid'`),
        db.select({value:sql<number>`count(*)::int`}).from(contacts).where(sql`${gmailScope} and ${contacts.validationStatus} in ('pending','unknown','error') and ${contacts.status}='active'`),
        db.select({value:systemSettings.value}).from(systemSettings).where(eq(systemSettings.key,"validation_paused")).limit(1),
        db.select().from(validationJobs).where(inArray(validationJobs.status,["pending","processing"])).orderBy(validationJobs.createdAt).limit(1),
        pool.query<{id:string;filename:string;unresolved:number}>(`
          select j.id,j.filename,count(distinct c.id)::int as unresolved
          from import_jobs j
          join import_staging_rows s on s.job_id=j.id
          join contacts c on c.id=s.contact_id
          where c.status='active'
            and c.validation_status in ('pending','unknown','error')
            and lower(c.normalized_email) ~ '@(gmail|googlemail)\\.com$'
          group by j.id,j.filename,j.created_at
          having count(distinct c.id) > 0
          order by j.created_at desc
          limit 20
        `),
      ]);
      jobs = jobRows;
      results = resultRows;
      gmail = gmailRows[0]?.value ?? 0;
      accepted = acceptedRows[0]?.value ?? 0;
      invalid = invalidRows[0]?.value ?? 0;
      unresolved = unresolvedRows[0]?.value ?? 0;
      paused = pauseRows[0]?.value === true;
      activeJob = activeRows[0] || null;
      imports = importRows.rows.map((row) => ({ id: row.id, filename: row.filename, unresolved: Number(row.unresolved || 0) }));
    } catch (error) {
      console.error("[validation-page] failed to read validation state", error);
      dbError = true;
    }
  }

  const usable = databaseConfigured && !dbError;

  return <AppShell session={session}>
    <div className="mb-5"><p className="page-eyebrow mb-1.5">Deliverability</p><h1 className="page-title">Gmail validation</h1><p className="page-description">Optional Gmail/Googlemail validation via Supersend. Campaign sending remains independent from this workflow.</p></div>

    {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Validation state unavailable.</b> The database could not be read.</div> : null}

    <section className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {[
        {l:"Gmail contacts",v:gmail,n:"Total scope"},
        {l:"Accepted / valid",v:accepted,n:"Positive verdicts"},
        {l:"Invalid",v:invalid,n:"Suppressed"},
        {l:"Needs validation",v:unresolved,n:"Pending / unknown / error"},
      ].map((x)=><article key={x.l} className="compact-stat"><div className="flex items-end justify-between gap-3"><div><p className="compact-stat-label">{x.l}</p><p className="compact-stat-value">{usable ? x.v.toLocaleString() : "—"}</p></div><p className="text-right text-[9.5px] font-semibold text-[var(--muted)]">{x.n}</p></div></article>)}
    </section>

    {usable ? <ValidationControls
      paused={paused}
      activeJob={activeJob ? { id:activeJob.id, scope:activeJob.scope, status:activeJob.status, processedRows:activeJob.processedRows, totalRows:activeJob.totalRows } : null}
      unresolved={unresolved}
      imports={imports}
    /> : null}

    <div className="mt-4 grid gap-4 xl:grid-cols-[.95fr_1.05fr]">
      <section className="premium-panel overflow-hidden">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="font-black">Validation jobs</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Recent queued, active and completed runs.</p>
        </div>
        {!usable ? <div className="p-6 text-center text-xs text-[var(--muted)]">Validation data unavailable.</div> : jobs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Scope</th><th>Status</th><th>Progress</th><th>Created</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{jobs.map((job)=><tr key={job.id} className="hover:bg-[var(--surface-soft)]"><td className="px-5 py-3.5"><div className="font-bold">{job.scope.startsWith("import:") ? "CSV import" : job.scope.startsWith("contact:") ? "Single contact" : job.scope === "gmail:unresolved" ? "Unresolved Gmail" : job.scope === "gmail:pending" ? "Pending Gmail" : job.scope}</div><div className="mt-0.5 font-mono text-[10px] text-[var(--muted)]">{job.id.slice(0,8)}</div></td><td><span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold capitalize ${job.status==="completed"?"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300":job.status==="failed"?"bg-rose-500/10 text-rose-700 dark:text-rose-300":"bg-blue-500/10 text-blue-700 dark:text-blue-300"}`}>{paused && activeJob?.id===job.id ? "paused" : job.status}</span></td><td className="text-xs font-bold text-[var(--muted)]">{job.processedRows.toLocaleString()} / {job.totalRows.toLocaleString()}</td><td className="text-xs text-[var(--muted)]">{new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short", timeZone:"Asia/Kolkata"}).format(job.createdAt)}</td></tr>)}</tbody></table></div> : <div className="p-8 text-center text-sm text-[var(--muted)]">No validation jobs yet.</div>}
      </section>

      <section className="premium-panel overflow-hidden">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="font-black">Result log</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Latest Gmail validation results returned by the configured validation provider.</p>
        </div>
        {!usable ? <div className="p-8 text-center text-sm text-[var(--muted)]">Validation data unavailable.</div> : results.length ? <div className="max-h-[620px] divide-y divide-[var(--border)] overflow-auto">{results.map((row)=><div key={row.id} className="p-4 transition hover:bg-[var(--surface-soft)]"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="break-all text-sm font-black">{row.email}</div><div className="mt-2 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-extrabold capitalize ${resultClass(row.status)}`}>{row.status}</span>{row.detail ? <span className="rounded-full bg-[var(--surface-soft)] px-2 py-1 font-mono text-[10px] text-[var(--muted)]">{row.detail}</span> : null}</div></div><time className="shrink-0 text-[11px] text-[var(--muted)]">{new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short", timeZone:"Asia/Kolkata"}).format(row.createdAt)}</time></div></div>)}</div> : <div className="p-8 text-center text-sm text-[var(--muted)]">No validation results yet.</div>}
      </section>
    </div>
  </AppShell>;
}
