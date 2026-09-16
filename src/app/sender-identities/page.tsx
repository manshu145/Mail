import { desc } from "drizzle-orm";
import { MailCheck, PauseCircle, Send, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SendingAccountActions } from "@/components/sending-account-actions";
import { db, databaseConfigured } from "@/db";
import { sendingAccounts } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function SenderIdentitiesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let rows: typeof sendingAccounts.$inferSelect[] = [];
  let dbError = false;
  if (databaseConfigured) {
    try { rows = await db.select().from(sendingAccounts).orderBy(desc(sendingAccounts.createdAt)).limit(100); }
    catch { dbError = true; }
  }
  const usable = databaseConfigured && !dbError;
  const active = rows.filter((row) => row.status === "active").length;
  const paused = rows.filter((row) => row.status === "paused").length;
  const totalDaily = rows.reduce((sum, row) => sum + row.dailyLimit, 0);

  return (
    <AppShell session={session}>
      <div className="mb-7">
        <p className="page-eyebrow mb-2">Sending infrastructure</p>
        <h1 className="page-title">Sender identities</h1>
        <p className="page-description">Manage approved From identities, reply-to addresses, transport type and per-identity sending limits.</p>
      </div>

      {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Sender configuration is unavailable in this preview.</b> Connect PostgreSQL to manage real sending identities.</div> : null}

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        {[{label:"Active senders",value:active,icon:ShieldCheck},{label:"Paused",value:paused,icon:PauseCircle},{label:"Combined daily limit",value:totalDaily,icon:Send}].map(({label,value,icon:Icon}) => <article key={label} className="metric-card p-5"><div className="flex items-start justify-between"><div><p className="text-[12px] font-extrabold text-[var(--muted)]">{label}</p><p className="mt-3 text-3xl font-black tracking-[-0.04em]">{value.toLocaleString()}</p></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Icon className="h-4.5 w-4.5" /></div></div></article>)}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {rows.length ? rows.map((row) => (
          <article key={row.id} className="premium-panel p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-black">{row.name}</h2><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[.1em] ${row.status === "active" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : row.status === "paused" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300"}`}>{row.status}</span></div><p className="mt-2 text-sm font-bold">{row.fromName} &lt;{row.fromEmail}&gt;</p><p className="mt-1 text-xs text-[var(--muted)]">Reply-to: {row.replyTo || "same as From"}</p></div>
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-300"><MailCheck className="h-5 w-5" /></div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2.5">
              <div className="panel-soft p-3"><p className="text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">Transport</p><p className="mt-1 text-sm font-extrabold capitalize">{row.transportType}</p></div>
              <div className="panel-soft p-3"><p className="text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">Hourly</p><p className="mt-1 text-sm font-extrabold">{row.hourlyLimit.toLocaleString()}</p></div>
              <div className="panel-soft p-3"><p className="text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">Daily</p><p className="mt-1 text-sm font-extrabold">{row.dailyLimit.toLocaleString()}</p></div>
            </div>
            <SendingAccountActions id={row.id} status={row.status} hourly={row.hourlyLimit} daily={row.dailyLimit} />
          </article>
        )) : <div className="premium-panel col-span-full grid min-h-64 place-items-center p-8 text-center"><div><MailCheck className="mx-auto h-8 w-8 text-[var(--muted)]" /><h3 className="mt-4 font-black">No sender identities</h3><p className="mt-1 text-sm text-[var(--muted)]">Verified sending accounts will appear here.</p></div></div>}
      </section>
    </AppShell>
  );
}
