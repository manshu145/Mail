import { Fingerprint, History, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { db, databaseConfigured } from "@/db";
import { auditLogs } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function AuditLogPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "operator") redirect("/dashboard");

  let rows: typeof auditLogs.$inferSelect[] = [];
  let dbError = false;
  if (databaseConfigured) {
    try { rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(250); } catch { dbError = true; }
  }
  const usable = databaseConfigured && !dbError;
  const authEvents = rows.filter((row) => row.action.toLowerCase().includes("login") || row.action.toLowerCase().includes("auth")).length;
  const mutationEvents = rows.length - authEvents;

  return (
    <AppShell session={session}>
      <div className="mb-7"><p className="page-eyebrow mb-2">Security</p><h1 className="page-title">Audit log</h1><p className="page-description">Review authentication activity and security-sensitive mutations with actor, entity and metadata context.</p></div>

      {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Audit storage unavailable.</b> Connect PostgreSQL to load persisted audit events.</div> : null}

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        {[{label:"Recent events",value:rows.length,icon:History},{label:"Auth events",value:authEvents,icon:Fingerprint},{label:"Mutations",value:mutationEvents,icon:ShieldCheck}].map(({label,value,icon:Icon}) => <article key={label} className="metric-card p-5"><div className="flex items-start justify-between"><div><p className="text-[12px] font-extrabold text-[var(--muted)]">{label}</p><p className="mt-3 text-3xl font-black tracking-[-0.04em]">{value.toLocaleString()}</p></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Icon className="h-4.5 w-4.5" /></div></div></article>)}
      </section>

      <section className="premium-panel overflow-hidden">
        {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.13em] text-[var(--muted)]"><tr><th className="px-5 py-3.5">Time</th><th>Action</th><th>Entity</th><th>Actor</th><th>Metadata</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-[var(--border)]"><td className="px-5 py-4 text-xs text-[var(--muted)]">{new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short", timeZone:"Asia/Kolkata"}).format(row.createdAt)}</td><td className="font-black">{row.action}</td><td className="text-xs text-[var(--muted)]">{row.entityType || "—"}{row.entityId ? ` · ${row.entityId.slice(0,8)}` : ""}</td><td className="font-mono text-xs text-[var(--muted)]">{row.actorUserId?.slice(0,8) || "system"}</td><td className="max-w-[360px] truncate font-mono text-[11px] text-[var(--muted)]">{row.metadataJson || "—"}</td></tr>)}</tbody></table></div> : <div className="grid min-h-64 place-items-center text-center"><div><History className="mx-auto h-8 w-8 text-[var(--muted)]" /><h2 className="mt-4 font-black">No audit events yet</h2><p className="mt-1 text-sm text-[var(--muted)]">Security-sensitive events will appear here.</p></div></div>}
      </section>
    </AppShell>
  );
}
