import { desc, eq } from "drizzle-orm";
import { AlertTriangle, CheckCircle2, Clock3, MailWarning } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ProviderCooldownActions } from "@/components/provider-cooldown-actions";
import { db, databaseConfigured } from "@/db";
import { providerCooldowns } from "@/db/operations-schema";
import { sendingAccounts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { providerLabel } from "@/lib/provider";

function formatDate(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export default async function ProviderCooldownsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let rows: Array<{
    id:string;
    provider:string;
    active:boolean;
    reason:string|null;
    lastResponse:string|null;
    detectedAt:Date;
    nextProbeAt:Date|null;
    lastProbeAt:Date|null;
    clearedAt:Date|null;
    updatedAt:Date;
    accountName:string|null;
    fromEmail:string|null;
  }> = [];
  let dbError=false;

  if (databaseConfigured) {
    try {
      rows = await db.select({
        id:providerCooldowns.id,
        provider:providerCooldowns.provider,
        active:providerCooldowns.active,
        reason:providerCooldowns.reason,
        lastResponse:providerCooldowns.lastResponse,
        detectedAt:providerCooldowns.detectedAt,
        nextProbeAt:providerCooldowns.nextProbeAt,
        lastProbeAt:providerCooldowns.lastProbeAt,
        clearedAt:providerCooldowns.clearedAt,
        updatedAt:providerCooldowns.updatedAt,
        accountName:sendingAccounts.name,
        fromEmail:sendingAccounts.fromEmail,
      }).from(providerCooldowns)
        .leftJoin(sendingAccounts,eq(providerCooldowns.sendingAccountId,sendingAccounts.id))
        .orderBy(desc(providerCooldowns.updatedAt))
        .limit(200);
    } catch { dbError=true; }
  }

  const usable=databaseConfigured&&!dbError;
  const active=rows.filter((row)=>row.active).length;
  const cleared=rows.filter((row)=>!row.active).length;
  const providers=new Set(rows.map((row)=>row.provider)).size;

  return <AppShell session={session}>
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="page-eyebrow mb-2">Deliverability</p>
        <h1 className="page-title">Provider cooldowns</h1>
        <p className="page-description">Temporary provider-level holds detected from live SMTP responses. NexiMail pauses only the affected mailbox provider for that sender and probes again automatically.</p>
      </div>
    </div>

    {!usable?<div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Cooldown status is temporarily unavailable.</b> Sending protection continues to run in the background.</div>:null}

    <section className="mb-4 grid gap-3 sm:grid-cols-3">
      <article className="compact-stat"><p className="compact-stat-label">Active cooldowns</p><p className="compact-stat-value">{active}</p></article>
      <article className="compact-stat"><p className="compact-stat-label">Cleared cooldowns</p><p className="compact-stat-value">{cleared}</p></article>
      <article className="compact-stat"><p className="compact-stat-label">Providers seen</p><p className="compact-stat-value">{providers}</p></article>
    </section>

    <section className="space-y-3">
      {rows.length?rows.map((row)=><article key={row.id} className="premium-panel p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-black">{providerLabel(row.provider)}</h2>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[.1em] ${row.active?"bg-amber-500/10 text-amber-700 dark:text-amber-300":"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>{row.active?"Cooldown active":"Cleared"}</span>
            </div>
            <p className="mt-1 text-xs font-bold">{row.accountName||"Sender identity"}{row.fromEmail?` · ${row.fromEmail}`:""}</p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{row.reason||"Temporary provider pressure detected."}</p>
          </div>
          <ProviderCooldownActions id={row.id} active={row.active} canEdit={usable && session.role === "owner"} />
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="panel-soft p-3"><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]"><AlertTriangle className="h-3.5 w-3.5"/>Detected</div><p className="mt-1 text-xs font-bold">{formatDate(row.detectedAt)}</p></div>
          <div className="panel-soft p-3"><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]"><Clock3 className="h-3.5 w-3.5"/>Next probe</div><p className="mt-1 text-xs font-bold">{row.active?formatDate(row.nextProbeAt):"Not scheduled"}</p></div>
          <div className="panel-soft p-3"><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]"><MailWarning className="h-3.5 w-3.5"/>Last probe</div><p className="mt-1 text-xs font-bold">{formatDate(row.lastProbeAt)}</p></div>
          <div className="panel-soft p-3"><div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]"><CheckCircle2 className="h-3.5 w-3.5"/>Cleared</div><p className="mt-1 text-xs font-bold">{formatDate(row.clearedAt)}</p></div>
        </div>

        {row.lastResponse?<details className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3"><summary className="cursor-pointer text-xs font-black">Last provider response</summary><pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-[var(--muted)]">{row.lastResponse}</pre></details>:null}
      </article>):<div className="premium-panel grid min-h-64 place-items-center p-8 text-center"><div><CheckCircle2 className="mx-auto h-9 w-9 text-emerald-500"/><h3 className="mt-4 font-black">No provider cooldowns</h3><p className="mt-1 max-w-md text-sm leading-6 text-[var(--muted)]">No temporary provider-level pressure has been recorded yet. If a provider throttles delivery, it will appear here automatically.</p></div></div>}
    </section>
  </AppShell>;
}
