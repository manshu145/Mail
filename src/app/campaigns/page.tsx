import { ArrowRight, Send, TimerReset } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { db, databaseConfigured } from "@/db";
import { campaigns } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function CampaignsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let rows: typeof campaigns.$inferSelect[] = [];
  let dbError = false;
  if (databaseConfigured) {
    try {
      rows = await db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(100);
    } catch {
      dbError = true;
    }
  }
  const usable = databaseConfigured && !dbError;

  return (
    <AppShell session={session}>
      <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-eyebrow mb-2">Messaging</p>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-description">Draft, schedule and monitor campaigns while keeping queue, policy and transport stages explicit.</p>
        </div>
        <ResourceCreate
          disabled={!usable}
          endpoint="/api/resources/campaigns"
          title="Create campaign draft"
          buttonLabel="Create campaign"
          fields={[
            { name: "name", label: "Internal campaign name", required: true, placeholder: "September customers" },
            { name: "subject", label: "Subject", required: true, placeholder: "Your subject line" },
            { name: "preheader", label: "Preheader", placeholder: "Optional preview text" },
          ]}
        />
      </div>

      {!usable ? (
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3.5 text-sm text-amber-900 dark:text-amber-200">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
          <div><b>Database not connected.</b> Draft creation is disabled and no campaign state is simulated.</div>
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          ["Draft-first", "Every campaign begins as an explicit draft."],
          ["Worker queued", "Web requests do not perform bulk delivery."],
          ["Traceable", "Recipient and transport state remain observable."],
        ].map(([title, copy]) => (
          <div key={title} className="panel-soft px-4 py-3.5">
            <p className="text-xs font-extrabold">{title}</p>
            <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">{copy}</p>
          </div>
        ))}
      </div>

      <section className="premium-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <p className="text-sm font-extrabold">Campaign workspace</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{rows.length ? `${rows.length} recent campaign${rows.length === 1 ? "" : "s"}` : "No campaign records yet"}</p>
          </div>
          <span className="status-pill"><TimerReset className="h-3.5 w-3.5" /> Worker pipeline</span>
        </div>

        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.13em] text-[var(--muted)]">
                <tr><th className="px-5 py-3.5">Campaign</th><th className="px-5 py-3.5">Subject</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5">Schedule</th><th className="px-5 py-3.5">Created</th><th className="px-5 py-3.5" /></tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((row) => (
                  <tr key={row.id} className="transition hover:bg-[var(--surface-soft)]">
                    <td className="px-5 py-4 font-extrabold"><Link href={`/campaigns/${row.id}`} className="hover:text-violet-700 dark:hover:text-violet-300">{row.name}</Link></td>
                    <td className="max-w-[320px] truncate px-5 py-4 text-[var(--muted)]">{row.subject}</td>
                    <td className="px-5 py-4"><span className="rounded-full border border-violet-500/10 bg-violet-500/[0.08] px-2.5 py-1 text-[11px] font-extrabold capitalize text-violet-700 dark:text-violet-300">{row.status}</span></td>
                    <td className="px-5 py-4 text-xs text-[var(--muted)]">{row.scheduledAt ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(row.scheduledAt) : "Not scheduled"}</td>
                    <td className="px-5 py-4 text-xs text-[var(--muted)]">{new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(row.createdAt)}</td>
                    <td className="px-5 py-4 text-right"><Link href={`/campaigns/${row.id}`} aria-label={`Open ${row.name}`} className="inline-grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:border-violet-500/20 hover:text-violet-700"><ArrowRight className="h-4 w-4" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid min-h-72 place-items-center p-8 text-center">
            <div className="max-w-sm">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><Send className="h-6 w-6" /></div>
              <h2 className="mt-4 text-lg font-black">No campaigns yet</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Create the first draft when the database is connected. Sending remains isolated behind queue and transport workers.</p>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}
