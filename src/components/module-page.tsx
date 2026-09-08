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
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">{eyebrow}</p>
          <h1 className="text-3xl font-black tracking-[-0.035em] text-slate-950 sm:text-4xl dark:text-white">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base dark:text-slate-400">{description}</p>
        </div>
      </div>
      {children ?? (
        <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="max-w-xl">
            <div className="mb-4 inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300">Module foundation ready</div>
            <h2 className="text-xl font-extrabold tracking-tight text-slate-950 dark:text-white">Built into the NexiMail PWA shell</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">This screen is wired into the production navigation and authentication shell. Its real data workflow is implemented phase-by-phase instead of using fake records.</p>
          </div>
        </section>
      )}
    </AppShell>
  );
}
