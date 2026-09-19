import { desc } from "drizzle-orm";
import { MailCheck, PauseCircle, Send, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
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
  const anyUnlimitedDaily = rows.some((row) => row.status === "active" && row.dailyLimit === 0);
  const totalDaily = rows.reduce((sum, row) => sum + (row.dailyLimit > 0 ? row.dailyLimit : 0), 0);

  return (
    <AppShell session={session}>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="page-eyebrow mb-2">Sending</p>
          <h1 className="page-title">Sender identities</h1>
          <p className="page-description">Manage approved From names, sender addresses and reply-to addresses.</p>
        </div>
        <ResourceCreate disabled={!usable || session.role !== "owner"} endpoint="/api/resources/sending-accounts" title="Add sender identity" buttonLabel="Add sender" fields={[{ name: "name", label: "Identity name", required: true }, { name: "fromName", label: "From name", required: true }, { name: "fromEmail", label: "From email", type: "email", required: true }, { name: "replyTo", label: "Reply-to", type: "email" }]} />
      </div>

      {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Sender configuration is temporarily unavailable.</b> Please refresh shortly.</div> : null}

      <section className="mb-4 grid gap-2 sm:grid-cols-3">
        {[{label:"Active senders",value:active,icon:ShieldCheck},{label:"Paused",value:paused,icon:PauseCircle},{label:"Combined daily limit",value:anyUnlimitedDaily?"Unlimited":totalDaily,icon:Send}].map(({label,value,icon:Icon}) => <article key={label} className="compact-stat"><div className="flex items-start justify-between"><div><p className="compact-stat-label">{label}</p><p className="compact-stat-value">{typeof value === "number" ? value.toLocaleString() : value}</p></div><div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Icon className="h-4.5 w-4.5" /></div></div></article>)}
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        {rows.length ? rows.map((row) => (
          <article key={row.id} className="premium-panel p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-[15px] font-black">{row.name}</h2><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[.1em] ${row.status === "active" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : row.status === "paused" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300"}`}>{row.status}</span></div><p className="mt-1.5 text-xs font-bold">{row.fromName} &lt;{row.fromEmail}&gt;</p><p className="mt-1 text-xs text-[var(--muted)]">Reply-to: {row.replyTo || "same as From"}</p></div>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300"><MailCheck className="h-5 w-5" /></div>
            </div>
            <div className="mt-3.5 grid grid-cols-2 gap-2">
              <div className="panel-soft p-3"><p className="text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">From address</p><p className="mt-1 truncate text-sm font-extrabold">{row.fromEmail}</p></div>
              <div className="panel-soft p-3"><p className="text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">Reply-to</p><p className="mt-1 truncate text-sm font-extrabold">{row.replyTo || row.fromEmail}</p></div>
            </div>
            <SendingAccountActions id={row.id} status={row.status} hourly={row.hourlyLimit} daily={row.dailyLimit} />
          </article>
        )) : <div className="premium-panel col-span-full grid min-h-64 place-items-center p-8 text-center"><div><MailCheck className="mx-auto h-8 w-8 text-[var(--muted)]" /><h3 className="mt-4 font-black">No sender identities</h3><p className="mt-1 text-sm text-[var(--muted)]">Add your first approved sender identity.</p></div></div>}
      </section>
    </AppShell>
  );
}
