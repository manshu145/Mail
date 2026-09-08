import { Activity, ArrowUpRight, CircleGauge, MailCheck, Send, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const metrics = [
    { label: "Total contacts", value: "0", note: "No contacts imported", icon: UsersRound, accent: "emerald" },
    { label: "Sent today", value: "0", note: "No campaign activity", icon: Send, accent: "violet" },
    { label: "Delivered", value: "0", note: "Remote acceptance", icon: MailCheck, accent: "amber" },
    { label: "Queued", value: "0", note: "Queue is clear", icon: CircleGauge, accent: "rose" },
  ];

  const accentClass: Record<string, { icon: string; line: string; glow: string }> = {
    emerald: { icon: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300", line: "bg-emerald-500", glow: "from-emerald-500/[0.07]" },
    violet: { icon: "bg-violet-500/10 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300", line: "bg-violet-500", glow: "from-violet-500/[0.07]" },
    amber: { icon: "bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300", line: "bg-amber-500", glow: "from-amber-500/[0.07]" },
    rose: { icon: "bg-rose-500/10 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300", line: "bg-rose-500", glow: "from-rose-500/[0.07]" },
  };

  return (
    <AppShell session={session}>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[11px] font-black uppercase tracking-[0.22em] text-zinc-400">Overview</p>
          <h1 className="text-3xl font-black tracking-[-0.045em] text-zinc-950 sm:text-4xl dark:text-white">Dashboard</h1>
          <p className="mt-2 text-sm text-zinc-500 sm:text-base dark:text-zinc-400">Contacts, campaign performance and infrastructure health in one place.</p>
        </div>
        <a href="/campaigns" className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-extrabold text-white shadow-[0_8px_24px_rgba(0,0,0,.12)] transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white">Create campaign <ArrowUpRight className="h-4 w-4" /></a>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          const accent = accentClass[metric.accent];
          return (
            <article key={metric.label} className={`group relative overflow-hidden rounded-[22px] border border-black/[0.065] bg-white p-5 shadow-[0_10px_30px_rgba(24,24,27,.045)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_42px_rgba(24,24,27,.075)] dark:border-white/[0.075] dark:bg-[#151516] dark:shadow-none`}>
              <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accent.glow} via-transparent to-transparent opacity-80`} />
              <div className={`absolute inset-x-0 top-0 h-[2px] ${accent.line}`} />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <p className="text-[13px] font-bold text-zinc-500 dark:text-zinc-400">{metric.label}</p>
                  <p className="mt-4 text-[36px] font-black leading-none tracking-[-0.055em] text-zinc-950 dark:text-white">{metric.value}</p>
                </div>
                <div className={`rounded-xl p-2.5 ${accent.icon}`}><Icon className="h-5 w-5" strokeWidth={1.9} /></div>
              </div>
              <div className="relative mt-5 flex items-center gap-2 border-t border-black/[0.05] pt-3 dark:border-white/[0.06]">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                <p className="text-xs font-medium text-zinc-400 dark:text-zinc-500">{metric.note}</p>
              </div>
            </article>
          );
        })}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <article className="rounded-[26px] border border-black/[0.065] bg-white p-6 shadow-[0_10px_35px_rgba(24,24,27,.04)] dark:border-white/[0.075] dark:bg-[#151516] dark:shadow-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">Campaign activity</p>
              <h2 className="mt-2 text-xl font-extrabold tracking-tight text-zinc-950 dark:text-white">Performance overview</h2>
            </div>
            <Activity className="h-5 w-5 text-zinc-400" />
          </div>
          <div className="mt-8 grid min-h-56 place-items-center rounded-2xl border border-dashed border-black/[0.08] bg-[#faf9f7] p-8 text-center dark:border-white/[0.08] dark:bg-white/[0.025]">
            <div>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-500/10 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300"><Send className="h-5 w-5" /></div>
              <p className="mt-4 text-sm font-bold text-zinc-800 dark:text-zinc-200">Your first campaign will appear here</p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">Only real send, delivery and engagement events will be shown.</p>
            </div>
          </div>
        </article>

        <article className="rounded-[26px] border border-black/[0.065] bg-white p-6 shadow-[0_10px_35px_rgba(24,24,27,.04)] dark:border-white/[0.075] dark:bg-[#151516] dark:shadow-none">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">Infrastructure</p>
          <h2 className="mt-2 text-xl font-extrabold tracking-tight text-zinc-950 dark:text-white">System readiness</h2>
          <div className="mt-6 space-y-2.5">
            {[
              ["Application", "Online", "bg-emerald-500"],
              ["PostgreSQL", "Runtime check", "bg-amber-500"],
              ["Redis", "Runtime check", "bg-amber-500"],
              ["Campaign workers", "Not configured", "bg-zinc-300 dark:bg-zinc-600"],
              ["Postfix", "Not configured", "bg-zinc-300 dark:bg-zinc-600"],
            ].map(([label, state, dot]) => (
              <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-black/[0.055] bg-[#fcfbf9] px-4 py-3 dark:border-white/[0.065] dark:bg-white/[0.025]">
                <span className="flex items-center gap-2.5 text-sm font-semibold text-zinc-700 dark:text-zinc-200"><span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{label}</span>
                <span className="text-xs font-bold text-zinc-400">{state}</span>
              </div>
            ))}
          </div>
          <a href="/system-health" className="mt-5 inline-flex items-center gap-2 text-sm font-extrabold text-zinc-800 transition hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white">View system health <ArrowUpRight className="h-4 w-4" /></a>
        </article>
      </section>
    </AppShell>
  );
}
