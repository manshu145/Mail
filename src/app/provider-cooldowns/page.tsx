import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProviderCooldownActions } from "@/components/provider-cooldown-actions";
import { db, databaseConfigured } from "@/db";
import { sendingAccounts } from "@/db/schema";
import { providerCooldowns } from "@/db/operations-schema";
import { providerCooldownEvents } from "@/db/provider-cooldown-event-schema";
import { getSession } from "@/lib/auth";
import { providerLabel } from "@/lib/provider";

const fmt = (d: Date | null | undefined) => d ? new Intl.DateTimeFormat("en",{dateStyle: "medium", timeStyle: "short", timeZone:"Asia/Kolkata"}).format(d) : "—";

export default async function ProviderCooldownsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  let rows: Array<{ id:string; provider:string; active:boolean; reason:string|null; lastResponse:string|null; detectedAt:Date; nextProbeAt:Date|null; lastProbeAt:Date|null; clearedAt:Date|null; accountName:string; fromEmail:string }> = [];
  let events: Array<{ id:string; provider:string; eventType:string; reason:string|null; response:string|null; occurredAt:Date; accountName:string; fromEmail:string }> = [];
  let dbError = false;
  if (databaseConfigured) try {
    [rows, events] = await Promise.all([
      db.select({
        id: providerCooldowns.id, provider: providerCooldowns.provider, active: providerCooldowns.active,
        reason: providerCooldowns.reason, lastResponse: providerCooldowns.lastResponse, detectedAt: providerCooldowns.detectedAt,
        nextProbeAt: providerCooldowns.nextProbeAt, lastProbeAt: providerCooldowns.lastProbeAt, clearedAt: providerCooldowns.clearedAt,
        accountName: sendingAccounts.name, fromEmail: sendingAccounts.fromEmail,
      }).from(providerCooldowns).innerJoin(sendingAccounts, eq(sendingAccounts.id, providerCooldowns.sendingAccountId)).orderBy(desc(providerCooldowns.updatedAt)).limit(250),
      db.select({
        id: providerCooldownEvents.id, provider: providerCooldownEvents.provider, eventType: providerCooldownEvents.eventType,
        reason: providerCooldownEvents.reason, response: providerCooldownEvents.response, occurredAt: providerCooldownEvents.occurredAt,
        accountName: sendingAccounts.name, fromEmail: sendingAccounts.fromEmail,
      }).from(providerCooldownEvents).innerJoin(sendingAccounts, eq(sendingAccounts.id, providerCooldownEvents.sendingAccountId)).orderBy(desc(providerCooldownEvents.occurredAt)).limit(500),
    ]);
  } catch (error) { console.error("[provider-cooldowns]", error); dbError = true; }
  const active = rows.filter(r => r.active);
  return <AppShell session={session}>
    <div className="mb-7"><p className="page-eyebrow mb-2">Deliverability protection</p><h1 className="page-title">Provider cooldowns</h1><p className="page-description">Mailbox-provider pressure is isolated per sending account. Current state and every cooldown incident are stored separately so repeated Gmail/Yahoo/Microsoft throttles remain auditable.</p></div>
    {!databaseConfigured || dbError ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200">Cooldown data is unavailable.</div> : null}
    <section className="mb-5 grid gap-3 sm:grid-cols-3">{[["Active cooldowns",active.length],["Recorded incidents",events.length],["Providers observed",new Set([...rows.map(r=>r.provider),...events.map(e=>e.provider)]).size]].map(([l,v])=><article key={String(l)} className="metric-card p-5"><p className="text-xs font-extrabold text-[var(--muted)]">{l}</p><p className="mt-3 text-3xl font-black">{Number(v).toLocaleString()}</p></article>)}</section>

    <section className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Current provider state</h2><p className="mt-1 text-xs text-[var(--muted)]">Automatic pressure detection, probe schedule and most recent provider response.</p></div>{rows.length?<div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Provider</th><th>Sending account</th><th>Status</th><th>Reason</th><th>Detected</th><th>Next probe</th><th>Last probe</th><th>Last provider response</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className="border-t border-[var(--border)] align-top"><td className="px-5 py-4 font-black">{providerLabel(r.provider)}</td><td><b>{r.accountName}</b><div className="text-xs text-[var(--muted)]">{r.fromEmail}</div></td><td><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${r.active?"bg-amber-500/10 text-amber-700 dark:text-amber-300":"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>{r.active?"Active":"Clear"}</span></td><td className="max-w-[180px] text-xs">{r.reason||"—"}</td><td className="text-xs text-[var(--muted)]">{fmt(r.detectedAt)}</td><td className="text-xs text-[var(--muted)]">{fmt(r.nextProbeAt)}</td><td className="text-xs text-[var(--muted)]">{fmt(r.lastProbeAt)}</td><td className="max-w-[360px] break-words text-xs leading-5 text-[var(--muted)]">{r.lastResponse||"—"}</td><td className="pr-5">{session.role==="owner"?<ProviderCooldownActions id={r.id} active={r.active}/>:null}</td></tr>)}</tbody></table></div>:<div className="p-10 text-center text-sm text-[var(--muted)]">No provider state recorded yet.</div>}</section>

    <section className="premium-panel mt-5 overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Incident history</h2><p className="mt-1 text-xs text-[var(--muted)]">Append-only detection, automatic clear and manual intervention records. Repeated incidents are not overwritten.</p></div>{events.length?<div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Time</th><th>Provider</th><th>Account</th><th>Event</th><th>Reason</th><th>Response</th></tr></thead><tbody>{events.map(e=><tr key={e.id} className="border-t border-[var(--border)] align-top"><td className="px-5 py-4 text-xs text-[var(--muted)]">{fmt(e.occurredAt)}</td><td className="font-black">{providerLabel(e.provider)}</td><td><b>{e.accountName}</b><div className="text-xs text-[var(--muted)]">{e.fromEmail}</div></td><td className="text-xs font-bold capitalize">{e.eventType.replaceAll("_"," ")}</td><td className="max-w-[220px] text-xs">{e.reason||"—"}</td><td className="max-w-[430px] break-words text-xs leading-5 text-[var(--muted)]">{e.response||"—"}</td></tr>)}</tbody></table></div>:<div className="p-10 text-center text-sm text-[var(--muted)]">No provider incidents recorded yet.</div>}</section>
  </AppShell>;
}
