import { ShieldCheck, Workflow } from "lucide-react";
import { redirect } from "next/navigation";
import { desc, sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { db, databaseConfigured } from "@/db";
import { contacts, validationJobs } from "@/db/schema";
import { getSession } from "@/lib/auth";

const gmailScope = sql`lower(${contacts.normalizedEmail}) ~ '@(gmail|googlemail)\\.com$'`;

export default async function ValidationPage() {
  const session = await getSession(); if (!session) redirect("/login");
  let jobs: typeof validationJobs.$inferSelect[] = [];
  let gmail = 0; let accepted = 0; let invalid = 0; let unknown = 0; let pending = 0; let dbError = false;
  if (databaseConfigured) {
    try {
      const [jobRows, gmailRows, acceptedRows, invalidRows, unknownRows, pendingRows] = await Promise.all([
        db.select().from(validationJobs).orderBy(desc(validationJobs.createdAt)).limit(50),
        db.select({value:sql<number>`count(*)::int`}).from(contacts).where(gmailScope),
        db.select({value:sql<number>`count(*)::int`}).from(contacts).where(sql`${gmailScope} and ${contacts.validationStatus}='accepted'`),
        db.select({value:sql<number>`count(*)::int`}).from(contacts).where(sql`${gmailScope} and ${contacts.validationStatus}='invalid'`),
        db.select({value:sql<number>`count(*)::int`}).from(contacts).where(sql`${gmailScope} and ${contacts.validationStatus} in ('unknown','error')`),
        db.select({value:sql<number>`count(*)::int`}).from(contacts).where(sql`${gmailScope} and ${contacts.validationStatus}='pending'`),
      ]);
      jobs=jobRows; gmail=gmailRows[0]?.value??0; accepted=acceptedRows[0]?.value??0; invalid=invalidRows[0]?.value??0; unknown=unknownRows[0]?.value??0; pending=pendingRows[0]?.value??0;
    } catch (error) {
      console.error("[validation-page] failed to read validation state", error);
      dbError=true;
    }
  }
  const usable = databaseConfigured && !dbError;
  return <AppShell session={session}>
    <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-extrabold uppercase tracking-[.18em] text-zinc-400">Deliverability</p><h1 className="text-3xl font-black tracking-[-.035em] sm:text-4xl">Validation</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">Gmail validation keeps provider outcomes explicit: <b>Accepted</b> means Gmail accepted the RCPT check, <b>Invalid</b> means an explicit mailbox-not-found response, and <b>Unknown</b> means temporary, policy, timeout or otherwise inconclusive. Newly imported pending Gmail contacts are picked up automatically.</p></div><ResourceCreate disabled={!usable} endpoint="/api/resources/validation-jobs" title="Queue Gmail validation" buttonLabel="Queue validation" fields={[]} /></div>
    {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Validation state unavailable.</b> The database could not be read, so NexiMail will not display synthetic zero results.</div> : null}
    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[{l:"Gmail contacts",v:gmail},{l:"Accepted",v:accepted},{l:"Invalid",v:invalid},{l:"Unknown / retry",v:unknown},{l:"Pending",v:pending}].map((x)=><article key={x.l} className="premium-panel p-5"><p className="text-sm font-bold text-zinc-500">{x.l}</p><p className="mt-2 text-3xl font-black tracking-[-.04em]">{usable ? x.v.toLocaleString() : "—"}</p></article>)}</section>
    <section className="premium-panel overflow-hidden">{!usable ? <div className="grid min-h-72 place-items-center p-8 text-center text-sm text-[var(--muted)]">Validation data is unavailable until the database connection recovers.</div> : jobs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-zinc-50 text-[11px] font-extrabold uppercase tracking-[.12em] text-zinc-400 dark:bg-zinc-900/70"><tr><th className="px-5 py-3.5">Job</th><th className="px-5 py-3.5">Scope</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5">Progress</th><th className="px-5 py-3.5">Created</th></tr></thead><tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">{jobs.map((job)=><tr key={job.id}><td className="px-5 py-4 font-mono text-xs">{job.id.slice(0,8)}</td><td className="px-5 py-4 font-bold">{job.scope.startsWith("import:") ? `Import ${job.scope.slice(7,15)}` : job.scope === "gmail:pending" ? "Auto · pending Gmail" : "All Gmail contacts"}</td><td className="px-5 py-4 text-xs font-bold capitalize text-zinc-500">{job.status}</td><td className="px-5 py-4 text-xs text-zinc-500">{job.processedRows.toLocaleString()}/{job.totalRows.toLocaleString()}</td><td className="px-5 py-4 text-xs text-zinc-400">{new Intl.DateTimeFormat("en",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(job.createdAt)}</td></tr>)}</tbody></table></div> : <div className="grid min-h-72 place-items-center p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-300"><ShieldCheck className="h-5 w-5" /></div><h2 className="mt-4 font-black">No validation jobs yet</h2><p className="mt-1 text-sm text-zinc-500">New pending Gmail contacts are queued automatically; manual full re-check remains available above.</p><div className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-zinc-400"><Workflow className="h-4 w-4" /> Worker-backed processing only</div></div></div>}</section>
  </AppShell>;
}
