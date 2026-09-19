import { ArrowRight, Send, TimerReset } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { LiveRefresh } from "@/components/live-refresh";
import { ResourceCreate } from "@/components/resource-create";
import { db, databaseConfigured } from "@/db";
import { campaigns } from "@/db/schema";
import { getSession } from "@/lib/auth";

function statusClass(status:string){
  if(status==="completed") return "border-emerald-500/15 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300";
  if(status==="sending"||status==="queued") return "border-blue-500/15 bg-blue-500/[0.08] text-blue-700 dark:text-blue-300";
  if(status==="paused"||status==="scheduled") return "border-amber-500/15 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300";
  if(status==="cancelled") return "border-rose-500/15 bg-rose-500/[0.08] text-rose-700 dark:text-rose-300";
  return "border-violet-500/15 bg-violet-500/[0.08] text-violet-700 dark:text-violet-300";
}

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
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-eyebrow mb-2">Messaging</p>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-description">Create, schedule and monitor campaigns from draft through delivery.</p>
        </div>
        <ResourceCreate
          disabled={!usable}
          endpoint="/api/resources/campaigns"
          title="Create campaign"
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
          <div><b>Campaigns are temporarily unavailable.</b> Please check the system status and try again.</div>
        </div>
      ) : null}

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        {[
          ["Build", "Create campaigns with subject, preheader, audience and content."],
          ["Schedule", "Send immediately or choose the exact delivery time."],
          ["Monitor", "Track campaign and recipient delivery status in one place."],
        ].map(([title, copy]) => (
          <div key={title} className="panel-soft px-3.5 py-3">
            <p className="text-[11px] font-extrabold">{title}</p>
            <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">{copy}</p>
          </div>
        ))}
      </div>

      <section className="premium-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-extrabold">Campaign workspace</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{rows.length ? `${rows.length} recent campaign${rows.length === 1 ? "" : "s"}` : "No campaigns yet"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2"><LiveRefresh intervalMs={10000} label="Live"/><span className="status-pill"><TimerReset className="h-3.5 w-3.5" /> Delivery status</span></div>
        </div>

        {rows.length ? (
          <>
            <div className="divide-y divide-[var(--border)] sm:hidden">
              {rows.map((row) => (
                <Link key={row.id} href={`/campaigns/${row.id}`} className="block p-4 transition active:bg-[var(--surface-soft)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black">{row.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{row.subject}</p>
                    </div>
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--muted)]" />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold capitalize ${statusClass(row.status)}`}>{row.status}</span>
                    <span className="text-[11px] font-semibold text-[var(--muted)]">
                      {row.scheduledAt ? new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(row.scheduledAt) : "Not scheduled"}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-[var(--muted)]">Created {new Intl.DateTimeFormat("en",{day:"2-digit",month:"short",year:"numeric",timeZone:"Asia/Kolkata"}).format(row.createdAt)}</p>
                </Link>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[800px] text-left text-xs">
                <thead className="bg-[var(--surface-soft)] text-[11px] font-black uppercase tracking-[.13em] text-[var(--muted)]">
                  <tr><th className="px-4 py-3">Campaign</th><th className="px-5 py-3.5">Subject</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5">Schedule</th><th className="px-5 py-3.5">Created</th><th className="px-5 py-3.5" /></tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {rows.map((row) => (
                    <tr key={row.id} className="transition hover:bg-[var(--surface-soft)]">
                      <td className="px-4 py-3 font-extrabold"><Link href={`/campaigns/${row.id}`} className="hover:text-violet-700 dark:hover:text-violet-300">{row.name}</Link></td>
                      <td className="max-w-[320px] truncate px-5 py-4 text-[var(--muted)]">{row.subject}</td>
                      <td className="px-5 py-4"><span className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold capitalize ${statusClass(row.status)}`}>{row.status}</span></td>
                      <td className="px-5 py-4 text-xs text-[var(--muted)]">{row.scheduledAt ? new Intl.DateTimeFormat("en",{dateStyle: "medium", timeStyle: "short", timeZone:"Asia/Kolkata"}).format(row.scheduledAt) : "Not scheduled"}</td>
                      <td className="px-5 py-4 text-xs text-[var(--muted)]">{new Intl.DateTimeFormat("en",{day: "2-digit", month: "short", year: "numeric", timeZone:"Asia/Kolkata"}).format(row.createdAt)}</td>
                      <td className="px-5 py-4 text-right"><Link href={`/campaigns/${row.id}`} aria-label={`Open ${row.name}`} className="inline-grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:border-violet-500/20 hover:text-violet-700"><ArrowRight className="h-4 w-4" /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="grid min-h-52 place-items-center p-8 text-center">
            <div className="max-w-sm">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><Send className="h-6 w-6" /></div>
              <h2 className="mt-4 text-lg font-black">No campaigns yet</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Create your first campaign, choose an audience and sender, then schedule or send it.</p>
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}
