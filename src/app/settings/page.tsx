import { KeyRound, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/auth";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <AppShell session={session}>
      <div className="mb-7">
        <p className="page-eyebrow mb-2">Workspace</p>
        <h1 className="page-title">Settings</h1>
        <p className="page-description">Workspace preferences and account-level controls for NexiMail.</p>
      </div>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <article className="premium-panel p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Workspace</p>
              <h2 className="mt-1 text-lg font-black">Workspace preferences</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                Operational controls are available in their dedicated NexiMail sections so customer-facing settings stay simple and safe.
              </p>
            </div>
          </div>
        </article>

        <aside className="space-y-4">
          <article className="premium-panel p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-black">Protected configuration</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                  Sensitive service configuration and security credentials are intentionally kept outside the customer-facing workspace settings.
                </p>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-violet-600" />
                <span className="text-sm font-bold">Signed-in role</span>
              </div>
              <span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-black capitalize text-violet-700 dark:text-violet-300">
                {session.role}
              </span>
            </div>
          </article>
        </aside>
      </section>
    </AppShell>
  );
}
