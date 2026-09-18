import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { CircleGauge, MailCheck, Search, ShieldAlert, Send } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { MessageActions } from "@/components/message-actions";
import { db, databaseConfigured } from "@/db";
import { messages } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { providerForEmail, providerLabel } from "@/lib/provider";

const statuses = ["queued","ready_for_transport","sending","mta_accepted","deferred","delivered","bounced","failed","cancelled"] as const;

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { q = "", status = "" } = await searchParams;

  let rows: typeof messages.$inferSelect[] = [];
  let inFlight = 0, delivered = 0, failed = 0;
  let dbError = false;
  if (databaseConfigured) {
    try {
      const clauses = [];
      if (q.trim()) clauses.push(or(ilike(messages.recipientEmail, `%${q.trim()}%`), ilike(messages.providerMessageId, `%${q.trim()}%`))!);
      if (statuses.includes(status as (typeof statuses)[number])) clauses.push(eq(messages.status, status as (typeof statuses)[number]));
      const [data, summary] = await Promise.all([
        db.select().from(messages).where(clauses.length ? and(...clauses) : undefined).orderBy(desc(messages.queuedAt)).limit(250),
        db.execute(sql`select
          count(*) filter(where status in ('queued','ready_for_transport','sending','mta_accepted','deferred'))::int as in_flight,
          count(*) filter(where status='delivered')::int as delivered,
          count(*) filter(where status in ('failed','bounced'))::int as failed
          from messages`),
      ]);
      rows = data;
      const totals = (summary.rows[0] || {}) as Record<string, unknown>;
      inFlight = Number(totals.in_flight || 0);
      delivered = Number(totals.delivered || 0);
      failed = Number(totals.failed || 0);
    } catch { dbError = true; }
  }
  const usable = databaseConfigured && !dbError;

  return (
    <AppShell session={session}>
      <div className="mb-7">
        <p className="page-eyebrow mb-2">Messaging operations</p>
        <h1 className="page-title">Message log</h1>
        <p className="page-description">Recipient-level delivery state with person-based timeline drill-down for transport, opens, clicks, bounces, complaints and unsubscribes.</p>
      </div>

      {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Message data is unavailable.</b> Connect PostgreSQL to inspect real delivery events and message controls.</div> : null}

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        {[{label:"In flight",value:inFlight,icon:CircleGauge},{label:"Delivered",value:delivered,icon:MailCheck},{label:"Bounce / failed",value:failed,icon:ShieldAlert}].map(({label,value,icon:Icon}) => <article key={label} className="metric-card p-5"><div className="flex items-start justify-between"><div><p className="text-[12px] font-extrabold text-[var(--muted)]">{label}</p><p className="mt-3 text-3xl font-black tracking-[-0.04em]">{usable ? value.toLocaleString() : "—"}</p></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Icon className="h-4.5 w-4.5" /></div></div></article>)}
      </section>

      <section className="premium-panel overflow-hidden">
        <div className="border-b border-[var(--border)] p-4 sm:px-5">
          <form className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" /><input defaultValue={q} name="q" placeholder="Search recipient or provider message ID…" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 pl-10 pr-3 text-sm outline-none focus:border-violet-500/40" /></div>
            <select defaultValue={status} name="status" className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm font-bold outline-none"><option value="">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{item.replaceAll("_"," ")}</option>)}</select>
            <button className="btn-secondary">Filter</button>
          </form>
        </div>
        {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1160px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[0.13em] text-[var(--muted)]"><tr><th className="px-5 py-3.5">Recipient</th><th>Provider</th><th>Status</th><th>Provider ID</th><th>Queued</th><th>Delivered</th><th>Last error</th><th></th></tr></thead><tbody>{rows.map((row) => { const provider=providerForEmail(row.recipientEmail); return <tr key={row.id} className="border-t border-[var(--border)]"><td className="px-5 py-4"><Link href={`/messages/${row.id}`} className="font-extrabold hover:text-violet-600 hover:underline">{row.recipientEmail}</Link><div className="mt-1 font-mono text-[10px] text-[var(--muted)]">{row.id}</div></td><td className="text-xs font-bold text-[var(--muted)]">{providerLabel(provider)}</td><td><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${row.status === "delivered" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : ["failed","bounced"].includes(row.status) ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{row.status.replaceAll("_"," ")}</span></td><td className="max-w-[220px] truncate text-xs text-[var(--muted)]">{row.providerMessageId || "—"}</td><td className="text-xs text-[var(--muted)]">{new Intl.DateTimeFormat("en", { dateStyle:"medium", timeStyle:"short" }).format(row.queuedAt)}</td><td className="text-xs text-[var(--muted)]">{row.deliveredAt ? new Intl.DateTimeFormat("en", { dateStyle:"medium", timeStyle:"short" }).format(row.deliveredAt) : "—"}</td><td className="max-w-[260px] truncate text-xs text-rose-500">{row.lastError || "—"}</td><td className="pr-5"><div className="flex items-center gap-2"><Link className="btn-secondary px-3 py-2 text-xs" href={`/messages/${row.id}`}>Timeline</Link><MessageActions id={row.id} status={row.status} /></div></td></tr>})}</tbody></table></div> : <div className="grid min-h-64 place-items-center p-8 text-center"><div><Send className="mx-auto h-8 w-8 text-[var(--muted)]" /><h3 className="mt-4 font-black">No matching messages</h3><p className="mt-1 text-sm text-[var(--muted)]">Delivery records will appear here as campaigns enter the sending pipeline.</p></div></div>}
      </section>
    </AppShell>
  );
}
