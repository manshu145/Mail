import { Activity, ArrowUpRight, CircleGauge, MailCheck, Send, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const metrics = [
    { label: "Total contacts", value: "0", note: "No contacts imported", icon: UsersRound },
    { label: "Sent today", value: "0", note: "No campaign activity", icon: Send },
    { label: "Delivered", value: "0", note: "Remote acceptance", icon: MailCheck },
    { label: "Queued", value: "0", note: "Queue is clear", icon: CircleGauge },
  ];

  return (
    <AppShell session={session}>
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">Overview</p>
          <h1 className="text-3xl font-black tracking-[-0.035em] text-slate-950 sm:text-4xl dark:text-white">Dashboard</h1>
          <p className="mt-2 text-sm text-slate-500 sm:text-base dark:text-slate-400">A real-time view of your contacts, campaigns and delivery infrastructure.</p>
        </div>
        <a href="/campaigns" className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700">Create campaign <ArrowUpRight className="h-4 w-4" /></a>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <article key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{metric.label}</p>
                  <p className="mt-3 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-white">{metric.value}</p>
                </div>
                <div className="rounded-xl bg-slate-100 p-2.5 text-slate-600 dark:bg-slate-900 dark:text-slate-300"><Icon className="h-5 w-5" strokeWidth={1.8} /></div>
              </div>
              <p className="mt-3 text-xs text-slate-400">{metric.note}</p>
            </article>
          );
        })}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-400">Campaign activity</p>
              <h2 className="mt-2 text-xl font-extrabold tracking-tight text-slate-950 dark:text-white">No campaign data yet</h2>
            </div>
            <Activity className="h-5 w-5 text-slate-400" />
          </div>
          <div className="mt-8 grid min-h-52 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center dark:border-slate-800 dark:bg-slate-900/30">
            <div>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300"><Send className="h-5 w-5" /></div>
              <p className="mt-4 text-sm font-bold text-slate-700 dark:text-slate-200">Your first campaign will appear here</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">NexiMail will never fabricate activity or delivery numbers.</p>
            </div>
          </div>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-slate-400">Infrastructure</p>
          <h2 className="mt-2 text-xl font-extrabold tracking-tight text-slate-950 dark:text-white">System readiness</h2>
          <div className="mt-6 space-y-3">
            {[
              ["Application", "Online"],
              ["PostgreSQL", "Runtime check"],
              ["Redis", "Runtime check"],
              ["Campaign workers", "Not configured"],
              ["Postfix", "Not configured"],
            ].map(([label, state]) => (
              <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-4 py-3 dark:border-slate-800">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
                <span className="text-xs font-bold text-slate-400">{state}</span>
              </div>
            ))}
          </div>
          <a href="/system-health" className="mt-5 inline-flex items-center gap-2 text-sm font-extrabold text-blue-600 dark:text-blue-400">View system health <ArrowUpRight className="h-4 w-4" /></a>
        </article>
      </section>
    </AppShell>
  );
}
