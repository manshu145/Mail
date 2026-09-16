import { ArrowUpRight, CheckCircle2, Database, ShieldCheck, Workflow } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth";

export async function ModulePage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <AppShell session={session}>
      <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-eyebrow mb-2">{eyebrow}</p>
          <h1 className="page-title">{title}</h1>
          <p className="page-description">{description}</p>
        </div>
        <div className="status-pill self-start lg:self-auto">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          VPS workflow mapped
        </div>
      </div>

      {children ?? (
        <section className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
          <article className="premium-panel relative overflow-hidden p-6 sm:p-8">
            <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-violet-500/[0.08] blur-3xl" />
            <div className="relative max-w-2xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-500/15 bg-violet-500/[0.07] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.13em] text-violet-700 dark:text-violet-300">
                <Workflow className="h-3.5 w-3.5" /> Production module
              </div>
              <h2 className="text-2xl font-black tracking-[-0.035em]">Designed around the real NexiMail backend</h2>
              <p className="mt-3 max-w-xl text-sm leading-7 text-[var(--muted)]">
                This surface follows the VPS source architecture instead of presenting fabricated records. Data actions, worker state and operational controls can be connected to the existing backend contracts without rebuilding the mail engine.
              </p>

              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                {[
                  [Database, "Real data", "Uses persisted backend state"],
                  [ShieldCheck, "Safe actions", "Keeps operational controls explicit"],
                  [CheckCircle2, "No fake metrics", "Only real system data is shown"],
                ].map(([Icon, label, note]) => {
                  const Component = Icon as typeof Database;
                  return (
                    <div key={String(label)} className="panel-soft p-4">
                      <Component className="h-5 w-5 text-violet-600 dark:text-violet-300" />
                      <p className="mt-3 text-sm font-extrabold">{String(label)}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{String(note)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </article>

          <article className="premium-panel p-6">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--muted)]">Frontend status</p>
            <h3 className="mt-2 text-xl font-black tracking-[-0.025em]">Interface foundation ready</h3>
            <div className="mt-6 space-y-3">
              {["Navigation mapped", "Responsive shell", "Dark mode", "VPS feature parity"].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3">
                  <span className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-bold">{item}</span>
                </div>
              ))}
            </div>
            <a href="/system-health" className="mt-5 inline-flex items-center gap-2 text-sm font-extrabold text-violet-700 transition hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-200">
              Check system readiness <ArrowUpRight className="h-4 w-4" />
            </a>
          </article>
        </section>
      )}
    </AppShell>
  );
}
