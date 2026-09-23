import { desc, eq, inArray, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ValidationControls } from "@/components/validation-controls";
import { db, databaseConfigured, pool } from "@/db";
import { contacts, importJobs, systemSettings, validationJobs, validationResults } from "@/db/schema";
import { getSession } from "@/lib/auth";

function resultClass(status: string) {
  if (status === "accepted" || status === "valid") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "invalid") return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (status === "pending") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-orange-500/10 text-orange-700 dark:text-orange-300";
}

function friendlyValidationDetail(detail: string | null) {
  const value = String(detail || "").toLowerCase();
  if (!value) return { label: "No detail", note: "" };
  if (value.includes("smtp_rcpt_250") || value.includes("supersend_v2_valid")) {
    return { label: "Mailbox accepted", note: "The recipient server/provider returned a positive validation result." };
  }
  if (value.includes("5.1.1") || value.includes("user_unknown") || value.includes("no_such_user") || value.includes("mailbox_not_found") || value.includes("supersend_v2_invalid")) {
    return { label: "Mailbox not found", note: "The provider returned an explicit invalid-mailbox result." };
  }
  if (value.startsWith("smtp_banner_") || value.startsWith("smtp_helo_") || value.startsWith("smtp_mail_from_")) {
    return { label: "Provider blocked the probe", note: "The mailbox was not evaluated. NexiMail will retry after the provider hold." };
  }
  if (value.includes("smtp_rcpt_4") || value.includes("temporary_or_policy")) {
    return { label: "Temporary provider deferral", note: "The provider deferred this check. This is not an invalid mailbox result." };
  }
  if (value.includes("provider_hold_active")) {
    return { label: "Provider temporarily held", note: "NexiMail paused new probes for this provider and will resume after the safety hold." };
  }
  if (value.includes("policy_or_ambiguous")) {
    return { label: "Provider policy / inconclusive", note: "The response was not explicit enough to mark the mailbox invalid." };
  }
  if (value.includes("timeout") || value.includes("connection_failed")) {
    return { label: "Temporary connection issue", note: "The mailbox was not conclusively checked." };
  }
  if (value.includes("supersend_v2_risky")) {
    return { label: "Risky / inconclusive", note: "SuperSend did not return a final valid or invalid verdict." };
  }
  if (value.startsWith("supersend_http_429")) {
    return { label: "SuperSend rate limited", note: "The external provider asked NexiMail to retry later." };
  }
  return { label: detail || "Unknown result", note: "" };
}

function validationModeLabel(mode: string) {
  if (mode === "hybrid") return "Smart Hybrid";
  if (mode === "supersend") return "SuperSend Primary";
  return "NexiMail Internal";
}

function jobScopeLabel(scope: string) {
  if (scope.startsWith("import:")) return "CSV import";
  if (scope.startsWith("contact:")) return "Single contact";
  if (scope === "pending") return "Unresolved contacts";
  if (scope === "gmail:unresolved") return "Legacy unresolved Gmail";
  if (scope === "gmail:pending") return "Legacy pending Gmail";
  return scope;
}

function formatValidationDate(value: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export default async function ValidationPage() {
  const session = await getSession(); if (!session) redirect("/login");

  let jobs: typeof validationJobs.$inferSelect[] = [];
  let results: typeof validationResults.$inferSelect[] = [];
  let totalContacts = 0, accepted = 0, invalid = 0, unresolved = 0;
  let paused = false;
  let activeJob: typeof validationJobs.$inferSelect | null = null;
  let imports: Array<{ id: string; filename: string; unresolved: number }> = [];
  let engine: {
    state:string;
    scheduler:string;
    concurrency:number;
    providerStartGapMs:number;
    providerBackoffMs:number;
    hardTimeoutMs:number;
    validationMode:string;
    validationsPerMinute:number;
    targetPerSecond:number|null;
    providerHoldMs:number;
    providerHolds:number;
    lastSeenAt:string|null;
  } | null = null;
  let dbError = false;

  if (databaseConfigured) {
    try {
      const [jobRows, resultRows, totalRows, acceptedRows, invalidRows, unresolvedRows, pauseRows, activeRows, importRows, engineRows, speedRows] = await Promise.all([
        db.select().from(validationJobs).orderBy(desc(validationJobs.createdAt)).limit(30),
        db.select().from(validationResults).orderBy(desc(validationResults.createdAt)).limit(80),
        db.select({value:sql<number>`count(*)::int`}).from(contacts).where(eq(contacts.status,"active")),
        db.select({value:sql<number>`count(*)::int`}).from(contacts).where(sql`${contacts.status}='active' and ${contacts.validationStatus} in ('accepted','valid')`),
        db.select({value:sql<number>`count(*)::int`}).from(contacts).where(sql`${contacts.status}='active' and ${contacts.validationStatus}='invalid'`),
        db.select({value:sql<number>`count(*)::int`}).from(contacts).where(sql`${contacts.validationStatus} in ('pending','unknown','error') and ${contacts.status}='active'`),
        db.select({value:systemSettings.value}).from(systemSettings).where(eq(systemSettings.key,"validation_paused")).limit(1),
        db.select().from(validationJobs).where(inArray(validationJobs.status,["pending","processing"])).orderBy(validationJobs.createdAt).limit(1),
        pool.query<{id:string;filename:string;unresolved:number}>(`
          select j.id,j.filename,count(distinct c.id)::int as unresolved
          from import_jobs j
          join import_staging_rows s on s.job_id=j.id
          join contacts c on c.id=s.contact_id
          where c.status='active'
            and c.validation_status in ('pending','unknown','error')
          group by j.id,j.filename,j.created_at
          having count(distinct c.id) > 0
          order by j.created_at desc
          limit 20
        `),
        pool.query<{last_seen_at:Date;metadata:Record<string,unknown>}>(`
          select last_seen_at,metadata
          from worker_heartbeats
          where worker_name='validation'
          limit 1
        `),
        pool.query<{per_minute:number}>(`
          select round(count(*)::numeric / 5, 1)::float as per_minute
          from validation_results
          where created_at > now()-interval '5 minutes'
        `),
      ]);
      jobs = jobRows;
      results = resultRows;
      totalContacts = totalRows[0]?.value ?? 0;
      accepted = acceptedRows[0]?.value ?? 0;
      invalid = invalidRows[0]?.value ?? 0;
      unresolved = unresolvedRows[0]?.value ?? 0;
      paused = pauseRows[0]?.value === true;
      activeJob = activeRows[0] || null;
      imports = importRows.rows.map((row) => ({ id: row.id, filename: row.filename, unresolved: Number(row.unresolved || 0) }));
      const engineRow = engineRows.rows[0];
      const metadata = (engineRow?.metadata || {}) as Record<string,unknown>;
      engine = engineRow ? {
        state:String(metadata.state || "unknown"),
        scheduler:String(metadata.scheduler || (metadata.concurrency ? "provider_aware" : "sequential")),
        concurrency:Number(metadata.concurrency || 1),
        providerStartGapMs:Number(metadata.providerStartGapMs || metadata.domainMinIntervalMs || 0),
        providerBackoffMs:Number(metadata.providerBackoffMs || metadata.domainBackoffMs || 0),
        hardTimeoutMs:Number(metadata.hardTimeoutMs || 0),
        validationMode:String(metadata.validationMode || activeRows[0]?.validationMode || "internal"),
        validationsPerMinute:Number(speedRows.rows[0]?.per_minute || 0),
        targetPerSecond:metadata.targetPerSecond == null ? null : Number(metadata.targetPerSecond),
        providerHoldMs:Number(metadata.providerHoldMs || 0),
        providerHolds:Number(metadata.providerHolds || 0),
        lastSeenAt:engineRow.last_seen_at ? engineRow.last_seen_at.toISOString() : null,
      } : null;
    } catch (error) {
      console.error("[validation-page] failed to read validation state", error);
      dbError = true;
    }
  }

  const usable = databaseConfigured && !dbError;
  const engineRunning = usable && !paused && Boolean(activeJob);
  const engineRatePerSecond = engine ? engine.validationsPerMinute / 60 : 0;

  return <AppShell session={session}>
    <div className="page-intro gap-4">
      <div className="min-w-0">
        <p className="page-eyebrow mb-1.5">Deliverability</p>
        <h1 className="page-title">Email validation</h1>
        <p className="page-description max-w-3xl">Validate recipient syntax, MX and mailbox responses with NexiMail Internal, Smart Hybrid or SuperSend Primary.</p>
      </div>
      {usable ? <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black ${paused ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300" : engineRunning ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)]"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-amber-500" : engineRunning ? "bg-emerald-500" : "bg-[var(--muted)]"}`} />
          {paused ? "Paused" : engineRunning ? "Validation running" : "Ready"}
        </span>
        {engine ? <span className="rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-1.5 text-[11px] font-extrabold text-[var(--muted)]">{validationModeLabel(engine.validationMode)}</span> : null}
        {engine ? <span className="rounded-full border border-violet-500/15 bg-violet-500/[.06] px-3 py-1.5 text-[11px] font-extrabold text-violet-700 dark:text-violet-300">{engineRatePerSecond.toFixed(2)}/s live</span> : null}
      </div> : null}
    </div>

    {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Validation state unavailable.</b> The database could not be read.</div> : null}

    <section className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
      {[
        {l:"Active contacts",v:totalContacts,n:"Total scope",tone:"violet"},
        {l:"Accepted / valid",v:accepted,n:"Positive verdicts",tone:"emerald"},
        {l:"Invalid",v:invalid,n:"Suppressed",tone:"rose"},
        {l:"Needs validation",v:unresolved,n:"Pending / unknown / error",tone:"amber"},
      ].map((x)=><article key={x.l} className="metric-card surface-lift min-w-0 p-3 sm:p-4">
        <div className="flex min-h-[84px] flex-col justify-between gap-3">
          <div className="flex items-start justify-between gap-2">
            <p className="compact-stat-label leading-4">{x.l}</p>
            <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${x.tone==="emerald"?"bg-emerald-500":x.tone==="rose"?"bg-rose-500":x.tone==="amber"?"bg-amber-500":"bg-violet-500"}`} />
          </div>
          <div>
            <p className="metric-value text-[1.35rem] font-black leading-none sm:text-[1.55rem]">{usable ? x.v.toLocaleString() : "—"}</p>
            <p className="mt-1.5 truncate text-[10px] font-semibold text-[var(--muted)] sm:text-[11px]">{x.n}</p>
          </div>
        </div>
      </article>)}
    </section>

    {usable ? <ValidationControls
      paused={paused}
      activeJob={activeJob ? { id:activeJob.id, scope:activeJob.scope, status:activeJob.status, validationMode:activeJob.validationMode, processedRows:activeJob.processedRows, totalRows:activeJob.totalRows } : null}
      unresolved={unresolved}
      imports={imports}
      engine={engine}
    /> : null}

    <div className="mt-4 grid gap-4 xl:grid-cols-[.92fr_1.08fr]">
      <section className="section-card overflow-hidden">
        <div className="section-card-header">
          <div>
            <h2 className="section-card-title">Validation jobs</h2>
            <p className="section-card-copy">Recent queued, active and completed runs.</p>
          </div>
          <span className="status-pill">{jobs.length} recent</span>
        </div>

        {!usable ? <div className="p-6 text-center text-xs text-[var(--muted)]">Validation data unavailable.</div> : jobs.length ? <>
          <div className="desktop-table-only overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Scope</th><th>Method</th><th>Status</th><th>Progress</th><th>Created</th></tr></thead>
              <tbody className="divide-y divide-[var(--border)]">{jobs.map((job)=><tr key={job.id} className="interactive-row">
                <td className="px-5 py-3.5"><div className="font-bold">{jobScopeLabel(job.scope)}</div><div className="mt-0.5 font-mono text-[11px] text-[var(--muted)]">{job.id.slice(0,8)}</div></td>
                <td><span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[11px] font-extrabold text-violet-700 dark:text-violet-300">{validationModeLabel(job.validationMode)}</span></td>
                <td><span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold capitalize ${job.status==="completed"?"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300":job.status==="failed"?"bg-rose-500/10 text-rose-700 dark:text-rose-300":"bg-blue-500/10 text-blue-700 dark:text-blue-300"}`}>{paused && activeJob?.id===job.id ? "paused" : job.status}</span></td>
                <td className="text-xs font-bold text-[var(--muted)]">{job.processedRows.toLocaleString()} / {job.totalRows.toLocaleString()}</td>
                <td className="text-xs text-[var(--muted)]">{formatValidationDate(job.createdAt)}</td>
              </tr>)}</tbody>
            </table>
          </div>

          <div className="mobile-card-list p-3">
            {jobs.slice(0,12).map((job)=>{
              const pct=job.totalRows ? Math.min(100,job.processedRows/job.totalRows*100) : 0;
              const status=paused && activeJob?.id===job.id ? "paused" : job.status;
              return <article key={job.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-[13px] font-black">{jobScopeLabel(job.scope)}</p><p className="mt-1 font-mono text-[10px] text-[var(--muted)]">{job.id.slice(0,8)}</p></div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase ${status==="completed"?"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300":status==="failed"?"bg-rose-500/10 text-rose-700 dark:text-rose-300":"bg-blue-500/10 text-blue-700 dark:text-blue-300"}`}>{status}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-[10px]"><span className="font-bold text-violet-700 dark:text-violet-300">{validationModeLabel(job.validationMode)}</span><span className="text-[var(--muted)]">{job.processedRows.toLocaleString()} / {job.totalRows.toLocaleString()}</span></div>
                <div className="progress-track mt-2"><div className="progress-fill" style={{width:`${pct}%`}} /></div>
                <p className="mt-2 text-[10px] text-[var(--muted)]">{formatValidationDate(job.createdAt)}</p>
              </article>;
            })}
          </div>
        </> : <div className="p-8 text-center text-sm text-[var(--muted)]">No validation jobs yet.</div>}
      </section>

      <section className="section-card overflow-hidden">
        <div className="section-card-header">
          <div className="min-w-0"><h2 className="section-card-title">Result log</h2><p className="section-card-copy">Latest mailbox verdicts with provider-safe explanations.</p></div>
          <span className="status-pill shrink-0">{results.length} latest</span>
        </div>

        {!usable ? <div className="p-8 text-center text-sm text-[var(--muted)]">Validation data unavailable.</div> : results.length ? <>
          <div className="desktop-table-only max-h-[620px] overflow-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-4 py-3">Email</th><th className="px-4 py-3">Verdict</th><th className="px-4 py-3">Detail</th><th className="px-4 py-3 text-right">Time</th></tr></thead>
              <tbody className="divide-y divide-[var(--border)]">{results.map((row)=>{
                const detail=friendlyValidationDetail(row.detail);
                return <tr key={row.id} className="interactive-row align-middle">
                  <td className="max-w-[280px] truncate px-4 py-3 font-bold">{row.email}</td>
                  <td className="px-4 py-3"><span className={"rounded-full px-2.5 py-1 text-[10px] font-black capitalize "+resultClass(row.status)}>{row.status}</span></td>
                  <td className="max-w-[320px] px-4 py-3"><div><span className="block truncate text-[11px] font-bold text-[var(--foreground)]" title={detail.note || row.detail || ""}>{detail.label}</span>{detail.note?<span className="mt-0.5 block truncate text-[10px] text-[var(--muted)]" title={row.detail || ""}>{detail.note}</span>:null}</div></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-[11px] text-[var(--muted)]">{formatValidationDate(row.createdAt)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>

          <div className="mobile-card-list max-h-[680px] overflow-y-auto p-3">
            {results.map((row)=>{
              const detail=friendlyValidationDetail(row.detail);
              return <article key={row.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 break-all text-[12px] font-black leading-4">{row.email}</p>
                  <span className={"shrink-0 rounded-full px-2 py-1 text-[9px] font-black capitalize "+resultClass(row.status)}>{row.status}</span>
                </div>
                <p className="mt-2.5 text-[11px] font-black">{detail.label}</p>
                {detail.note?<p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">{detail.note}</p>:null}
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2"><span className="max-w-[62%] truncate font-mono text-[9px] text-[var(--muted)]">{row.detail || "—"}</span><span className="whitespace-nowrap text-[9px] text-[var(--muted)]">{formatValidationDate(row.createdAt)}</span></div>
              </article>;
            })}
          </div>
        </> : <div className="p-8 text-center text-sm text-[var(--muted)]">No validation results yet.</div>}
      </section>
    </div>
  </AppShell>;
}
