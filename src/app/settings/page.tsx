import Link from "next/link";
import { Gauge, KeyRound, ShieldCheck, TimerReset } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DeliverySettingsForm } from "@/components/delivery-settings-form";
import { databaseConfigured } from "@/db";
import { getSession } from "@/lib/auth";
import { defaultDeliverySettings, readDeliverySettings } from "@/lib/delivery-settings";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let settings = defaultDeliverySettings();
  let settingsReady = false;
  if (databaseConfigured) {
    try {
      settings = await readDeliverySettings();
      settingsReady = true;
    } catch {}
  }
  const editable = settingsReady && session.role === "owner";

  return (
    <AppShell session={session}>
      <div className="mb-7">
        <p className="page-eyebrow mb-2">Workspace</p>
        <h1 className="page-title">Settings</h1>
        <p className="page-description">Control sending limits, reputation protection and retry behavior without exposing infrastructure secrets.</p>
      </div>

      {!settingsReady ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Delivery settings are temporarily unavailable.</b> Current runtime defaults remain active.</div> : null}

      <section className="premium-panel p-4 sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><Gauge className="h-5 w-5" /></div>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Deliverability</p>
            <h2 className="mt-1 text-lg font-black">Reputation & delivery controls</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">These values are read by the live sending and reputation workers. Changes apply without editing server configuration.</p>
          </div>
        </div>
        <DeliverySettingsForm initial={settings} editable={editable} />
      </section>

      <section className="mt-5 grid gap-4 md:grid-cols-2">
        <Link href="/provider-cooldowns" className="premium-panel p-5 transition hover:-translate-y-0.5 hover:border-violet-500/30">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300"><TimerReset className="h-5 w-5" /></div>
            <div><h2 className="font-black">Provider cooldowns</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">See when Gmail, Yahoo, Microsoft or another mailbox provider is temporarily holding or throttling delivery.</p></div>
          </div>
        </Link>

        <article className="premium-panel p-5">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-5 w-5" /></div>
            <div><h2 className="font-black">Protected configuration</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">Credentials, signing keys and service-level secrets remain outside this customer-facing page.</p></div>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-3">
            <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-violet-600" /><span className="text-sm font-bold">Signed-in role</span></div>
            <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-black capitalize text-violet-700 dark:text-violet-300">{session.role}</span>
          </div>
        </article>
      </section>
    </AppShell>
  );
}
