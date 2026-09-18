import { Gauge, ShieldCheck, TimerReset } from "lucide-react";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { DeliverySettingsForm } from "@/components/delivery-settings-form";
import { db, databaseConfigured } from "@/db";
import { getSession } from "@/lib/auth";
import { readDeliverySettings, type DeliverySettings } from "@/lib/delivery-settings";

export default async function SendingLimitsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let dbError = false;
  let hour = 0;
  let day = 0;
  let active = 0;
  let settings: DeliverySettings | null = null;

  if (databaseConfigured) {
    try {
      settings = await readDeliverySettings();
      const result = await db.execute(sql`select
        count(*) filter(where accepted_at>=now()-interval '1 hour')::int as hour_count,
        count(*) filter(where accepted_at>=now()-interval '24 hours')::int as day_count,
        count(*) filter(where status in ('queued','ready_for_transport','sending','mta_accepted','deferred'))::int as active_count
        from messages`);
      const row = (result.rows[0] || {}) as Record<string, unknown>;
      hour = Number(row.hour_count || 0);
      day = Number(row.day_count || 0);
      active = Number(row.active_count || 0);
    } catch (error) {
      console.error("[sending-limits]", error);
      dbError = true;
    }
  }

  const currentSettings = !dbError && databaseConfigured ? settings : null;

  return <AppShell session={session}>
    <div className="mb-7"><p className="page-eyebrow mb-2">Delivery controls</p><h1 className="page-title">Sending limits</h1><p className="page-description">Every editable value on this page is stored in the database control plane and is intended for worker enforcement rather than decorative configuration.</p></div>
    {!currentSettings ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200">Sending-limit state is unavailable because the database could not be read.</div> : null}
    {currentSettings ? <>
      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[
        ["Used last hour", currentSettings.maxRollingHour === 0 ? `${hour.toLocaleString()} / Unlimited` : `${hour.toLocaleString()} / ${currentSettings.maxRollingHour.toLocaleString()}`],
        ["Used last 24 hours", currentSettings.maxRolling24h === 0 ? `${day.toLocaleString()} / Unlimited` : `${day.toLocaleString()} / ${currentSettings.maxRolling24h.toLocaleString()}`],
        ["Active / retry queue", `${active.toLocaleString()} / ${currentSettings.maxActiveQueued.toLocaleString()}`],
        ["Per second", currentSettings.maxPerSecond.toLocaleString()],
        ["Max / campaign", currentSettings.maxRecipientsPerCampaign === 0 ? "Unlimited" : currentSettings.maxRecipientsPerCampaign.toLocaleString()],
      ].map(([l, v]) => <article className="metric-card p-5" key={String(l)}><p className="text-xs font-extrabold text-[var(--muted)]">{l}</p><p className="mt-3 text-2xl font-black">{v}</p></article>)}</section>

      <section className="premium-panel p-5 sm:p-6"><div className="mb-5 flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><Gauge className="h-5 w-5"/></div><div><h2 className="font-black">Throughput, retry & reputation guard</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Owner changes are audited. Transport, policy, campaign and reputation workers consume the shared settings instead of relying on UI-only values.</p></div></div><DeliverySettingsForm initial={currentSettings} editable={session.role === "owner"}/></section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2"><article className="premium-panel p-5"><div className="flex gap-3"><TimerReset className="mt-0.5 h-5 w-5 text-amber-500"/><div><h3 className="font-black">Retry policy</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Up to {currentSettings.retryMaxAttempts} transport attempts with an initial {currentSettings.retryInitialSeconds}s delay, progressive ×{currentSettings.retryBackoffMultiplier} backoff and a {currentSettings.retryMaxSeconds}s maximum wait.</p></div></div></article><article className="premium-panel p-5"><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600"/><div><h3 className="font-black">Reputation guard</h3><p className="mt-2 text-sm leading-6 text-[var(--muted)]">After at least {currentSettings.reputationMinSample.toLocaleString()} 24-hour sends, an account can be paused at {(currentSettings.reputationBounceStopRate * 100).toFixed(2)}% bounce or {(currentSettings.reputationComplaintStopRate * 100).toFixed(3)}% complaint rate.</p></div></div></article></section>
    </> : null}
  </AppShell>;
}
