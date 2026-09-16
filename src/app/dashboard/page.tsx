import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CircleGauge,
  Database,
  FileUp,
  Globe2,
  MailCheck,
  Network,
  Plus,
  Send,
  ServerCog,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { db, databaseConfigured } from "@/db";
import { contacts, messages } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { isRedisConfigured } from "@/lib/redis";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let totalContacts = 0;
  let sentToday = 0;
  let delivered = 0;
  let queued = 0;
  let dbHealthy = false;

  if (databaseConfigured) {
    try {
      const [contactsRows, sentRows, deliveredRows, queuedRows] = await Promise.all([
        db.select({ value: sql<number>`count(*)::int` }).from(contacts),
        db.select({ value: sql<number>`count(*)::int` }).from(messages).where(sql`${messages.queuedAt} >= date_trunc('day', now())`),
        db.select({ value: sql<number>`count(*)::int` }).from(messages).where(sql`${messages.status} = 'delivered'`),
        db.select({ value: sql<number>`count(*)::int` }).from(messages).where(sql`${messages.status} in ('queued','ready_for_transport','sending','deferred')`),
      ]);
      totalContacts = contactsRows[0]?.value ?? 0;
      sentToday = sentRows[0]?.value ?? 0;
      delivered = deliveredRows[0]?.value ?? 0;
      queued = queuedRows[0]?.value ?? 0;
      dbHealthy = true;
    } catch {
      dbHealthy = false;
    }
  }

  const redisReady = isRedisConfigured();
  const metrics = [
    { label: "Total contacts", value: totalContacts.toLocaleString(), note: databaseConfigured ? "Persisted recipients" : "Connect PostgreSQL for live data", icon: UsersRound, tint: "emerald" },
    { label: "Messages today", value: sentToday.toLocaleString(), note: "Entered the sending pipeline", icon: Send, tint: "violet" },
    { label: "Delivered", value: delivered.toLocaleString(), note: "Confirmed remote delivery state", icon: MailCheck, tint: "blue" },
    { label: "Active queue", value: queued.toLocaleString(), note: "Queued, sending or deferred", icon: CircleGauge, tint: "amber" },
  ];

  const tint: Record<string, string> = {
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
    blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  };

  const system = [
    { label: "Application", state: "Online", good: true },
    { label: "PostgreSQL", state: dbHealthy ? "Online" : databaseConfigured ? "Unavailable" : "Not configured", good: dbHealthy },
    { label: "Redis", state: redisReady ? "Configured" : "Not configured", good: redisReady },
    { label: "Campaign workers", state: "VPS runtime", good: true },
    { label: "Postfix transport", state: "VPS runtime", good: true },
  ];

  return (
    <AppShell session={session}>
      <div className="mb-8 grid gap-6 xl:grid-cols-[1fr_auto] xl:items-end">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="page-eyebrow">Command center</p>
            <span className="status-pill"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Control plane online</span>
          </div>
          <h1 className="page-title">Good to see you, {session.name.split(" ")[0]}.</h1>
          <p className="page-description">Your audience, delivery pipeline, reputation signals and infrastructure state — without fake demo analytics.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <a href="/imports" className="btn-secondary"><FileUp className="h-4 w-4" /> Import contacts</a>
          <a href="/campaigns" className="btn-primary"><Plus className="h-4 w-4" /> New campaign</a>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <article key={metric.label} className="metric-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[12px] font-extrabold text-[var(--muted)]">{metric.label}</p>
                  <p className="mt-4 text-[38px] font-black leading-none tracking-[-0.055em]">{metric.value}</p>
                </div>
                <div className={`grid h-11 w-11 place-items-center rounded-[14px] ${tint[metric.tint]}`}>
                  <Icon className="h-5 w-5" strokeWidth={1.9} />
                </div>
              </div>
              <div className="mt-5 border-t border-[var(--border)] pt-3">
                <p className="text-[11px] font-semibold leading-5 text-[var(--muted)]">{metric.note}</p>
              </div>
            </article>
          );
        })}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_.75fr]">
        <article className="premium-panel overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-[var(--border)] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--muted)]">Sending flow</p>
              <h2 className="mt-1 text-xl font-black tracking-[-0.025em]">Mail pipeline</h2>
            </div>
            <a href="/infrastructure" className="inline-flex items-center gap-1.5 text-xs font-extrabold text-violet-700 dark:text-violet-300">Infrastructure <ArrowUpRight className="h-3.5 w-3.5" /></a>
          </div>

          <div className="grid gap-3 p-6 sm:grid-cols-2 xl:grid-cols-4">
            {[
              [UsersRound, "Audience", "Contacts & segments", "/contacts"],
              [Send, "Campaign engine", "Scheduling & workers", "/campaigns"],
              [Network, "Transport", "Accounts & Postfix", "/infrastructure"],
              [MailCheck, "Delivery events", "Bounce & engagement", "/reports"],
            ].map(([Icon, label, note, href], index) => {
              const Component = Icon as typeof UsersRound;
              return (
                <a key={String(label)} href={String(href)} className="group relative panel-soft p-4 transition hover:-translate-y-0.5 hover:border-violet-500/20 hover:bg-violet-500/[0.035]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Component className="h-4.5 w-4.5" /></div>
                    <span className="text-[10px] font-black text-[var(--muted)]">0{index + 1}</span>
                  </div>
                  <p className="mt-4 text-sm font-extrabold">{String(label)}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{String(note)}</p>
                  <ArrowRight className="mt-4 h-4 w-4 text-[var(--muted)] transition group-hover:translate-x-1 group-hover:text-violet-600" />
                </a>
              );
            })}
          </div>

          <div className="mx-6 mb-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-soft)] px-5 py-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-700 dark:text-blue-300"><Activity className="h-5 w-5" /></div>
                <div>
                  <p className="text-sm font-extrabold">Performance charts will appear from real message events</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">No generated open-rate, click-rate or delivery trends are shown in preview mode.</p>
                </div>
              </div>
              <a href="/reports" className="btn-secondary shrink-0 !min-h-9 !py-2 text-xs">View analytics</a>
            </div>
          </div>
        </article>

        <article className="premium-panel p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--muted)]">Runtime</p>
              <h2 className="mt-1 text-xl font-black tracking-[-0.025em]">System readiness</h2>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"><ShieldCheck className="h-5 w-5" /></div>
          </div>

          <div className="mt-6 space-y-2.5">
            {system.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3">
                <span className="flex min-w-0 items-center gap-2.5 text-[13px] font-bold">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${item.good ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,.09)]" : "bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,.09)]"}`} />
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.1em] text-[var(--muted)]">{item.state}</span>
              </div>
            ))}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <a href="/system-health" className="panel-soft flex items-center gap-2 p-3 text-xs font-extrabold transition hover:border-violet-500/20"><ServerCog className="h-4 w-4 text-violet-600" /> Health</a>
            <a href="/domains" className="panel-soft flex items-center gap-2 p-3 text-xs font-extrabold transition hover:border-violet-500/20"><Globe2 className="h-4 w-4 text-violet-600" /> Domains</a>
          </div>

          <div className="mt-4 rounded-2xl bg-gradient-to-br from-[#171a21] to-[#242a36] p-4 text-white dark:from-[#1a1f29] dark:to-[#101318]">
            <div className="flex items-center gap-2"><Database className="h-4 w-4 text-violet-300" /><p className="text-xs font-extrabold">VPS backend remains source of truth</p></div>
            <p className="mt-2 text-[11px] leading-5 text-white/50">The preview UI maps to the real deployment architecture while keeping infrastructure secrets and production data off this frontend environment.</p>
          </div>
        </article>
      </section>
    </AppShell>
  );
}
