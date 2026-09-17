import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProviderCooldownActions } from "@/components/provider-cooldown-actions";
import { db, databaseConfigured } from "@/db";
import { sendingAccounts } from "@/db/schema";
import { providerCooldowns } from "@/db/operations-schema";
import { getSession } from "@/lib/auth";
import { providerLabel } from "@/lib/provider";

const fmt = (d: Date | null | undefined) => d ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(d) : "—";

export default async function ProviderCooldownsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  let rows: Array<{ id:string; provider:string; active:boolean; reason:string|null; lastResponse:string|null; detectedAt:Date; nextProbeAt:Date|null; lastProbeAt:Date|null; clearedAt:Date|null; accountName:string; fromEmail:string }> = [];
  let dbError = false;
  if (databaseConfigured) try {
    rows = await db.select({
      id: providerCooldowns.id, provider: providerCooldowns.provider, active: providerCooldowns.active,
      reason: providerCooldowns.reason, lastResponse: providerCooldowns.lastResponse, detectedAt: providerCooldowns.detectedAt,
      nextProbeAt: providerCooldowns.nextProbeAt, lastProbeAt: providerCooldowns.lastProbeAt, clearedAt: providerCooldowns.clearedAt,
      accountName: sendingAccounts.name, fromEmail: sendingAccounts.fromEmail,
    }).from(providerCooldowns).innerJoin(sendingAccounts, eq(sendingAccounts.id, providerCooldowns.sendingAccountId)).orderBy(desc(providerCooldowns.updatedAt)).limit(250);
  } catch { dbError = true; }
  const active = rows.filter(r => r.active);
  const historical = rows.filter(r => !r.active);
  return <AppShell session={session}>
    <div className="mb-7"><p className="page-eyebrow mb-2">Deliverability protection</p><h1 className="page-title">Provider cooldowns</h1><p className="page-description">Mailbox-provider pressure is isolated per sending account. A Gmail throttle can pause Gmail recipients while Yahoo, Microsoft and other providers continue.</p></div>
    {!databaseConfigured || dbError ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Cooldown data is unavailable.</div> : null}
    <section className="mb-5 grid gap-3 sm:grid-cols-3">{[["Active cooldowns",active.length],["Cleared / historical",historical.length],["Providers observed",new Set(rows.map(r=>r.provider)).size]].map(([l,v])=><article key={String(l)} className="metric-card p-5"><p className="text-xs font-extrabold text-[var(--muted)]">{l}</p><p className="mt-3 text-3xl font-black">{Number(v).toLocaleString()}</p></article>)}</section>
    <section className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Cooldown state</h2><p className="mt-1 text-xs text-[var(--muted)]">Automatic provider pressure detection, probe schedule and last SMTP response.</p></div>{rows.length?<div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Provider</th><th>Sending account</th><th>Status</th><th>Reason</th><th>Detected</th><th>Next probe</th><th>Last probe</th><th>Last provider response</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className="border-t border-[var(--border)] align-top"><td className="px-5 py-4 font-black">{providerLabel(r.provider)}</td><td><b>{r.accountName}</b><div className="text-xs text-[var(--muted)]">{r.fromEmail}</div></td><td><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${r.active?"bg-amber-500/10 text-amber-700 dark:text-amber-300":"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>{r.active?"Active":"Cleared"}</span></td><td className="max-w-[180px] text-xs">{r.reason||"—"}</td><td className="text-xs text-[var(--muted)]">{fmt(r.detectedAt)}</td><td className="text-xs text-[var(--muted)]">{fmt(r.nextProbeAt)}</td><td className="text-xs text-[var(--muted)]">{fmt(r.lastProbeAt)}</td><td className="max-w-[360px] break-words text-xs leading-5 text-[var(--muted)]">{r.lastResponse||"—"}</td><td className="pr-5">{session.role==="owner"?<ProviderCooldownActions id={r.id} active={r.active}/>:null}</td></tr>)}</tbody></table></div>:<div className="p-10 text-center text-sm text-[var(--muted)]">No provider cooldowns recorded yet.</div>}</section>
  </AppShell>;
}
