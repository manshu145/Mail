import { CheckCircle2 } from "lucide-react";
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
      <div className="mb-8">
        <p className="page-eyebrow mb-2">{eyebrow}</p>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {children ?? (
        <section className="premium-panel p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-lg font-black">Workspace ready</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">Use the navigation to manage this NexiMail workspace.</p>
            </div>
          </div>
        </section>
      )}
    </AppShell>
  );
}
