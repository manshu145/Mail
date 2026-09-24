import { ArrowRight, CheckCircle2, Clock3, Radio, Send, Shuffle, Sparkles } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { db, databaseConfigured, pool } from "@/db";
import { campaigns } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { defaultDeliverySettings, readDeliverySettings } from "@/lib/delivery-settings";

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
  let deliverySettings = defaultDeliverySettings();
  let activeStats: Array<{ id:string; total:number; active:number; delivered:number; issues:number }> = [];
  let dbError = false;
  if (databaseConfigured) {
    try {
      const [campaignRows, settings, stats] = await Promise.all([
        db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(100),
        readDeliverySettings(),
        pool.query<{id:string;total:number;active:number;delivered:number;issues:number}>(`
          select
            c.id::text,
            count(m.id)::int as total,
            count(m.id) filter(where m.status in ('queued','ready_for_transport','sending','mta_accepted','deferred'))::int as active,
            count(m.id) filter(where m.status='delivered')::int as delivered,
            count(m.id) filter(where m.status in ('bounced','failed','cancelled'))::int as issues
          from campaigns c
          left join messages m on m.campaign_id=c.id
          where c.status='sending'
          group by c.id
        `),
      ]);
      rows = campaignRows;
      deliverySettings = settings;
      activeStats = stats.rows.map((row)=>({
        id:row.id,
        total:Number(row.total||0),
        active:Number(row.active||0),
        delivered:Number(row.delivered||0),
        issues:Number(row.issues||0),
      }));
    } catch {
      dbError = true;
    }
  }
  const usable = databaseConfigured && !dbError;
  const activeCount=rows.filter((row)=>["queued","sending","scheduled"].includes(row.status)).length;
  const sendingCount=rows.filter((row)=>row.status==="sending").length;
  const activeStatMap=new Map(activeStats.map((row)=>[row.id,row]));
  const draftCount=rows.filter((row)=>row.status==="draft").length;
  const completedCount=rows.filter((row)=>row.status==="completed").length;

  return (
    <AppShell session={session}>
      <div className="page-intro">
        <div>
          <div className="mb-2 flex items-center gap-2"><p className="page-eyebrow">Messaging</p><span className="status-pill"><Sparkles className="h-3 w-3"/>Campaign studio</span></div>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-description">Create, schedule and monitor campaigns from draft through delivery.</p>
        </div>
        <ResourceCreate
          disabled={!usable}
          endpoint="/api/resources/campaigns"
          title="Create campaign"
          buttonLabel="Create campaign"
          submitLabel="Next"
          redirectBasePath="/campaigns"
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

      <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [Clock3,"Drafts",draftCount,"Campaigns still being prepared"],
          [Radio,"Live / scheduled",activeCount,"Queued, sending or scheduled"],
          [Shuffle,"Sending now",sendingCount,"Active campaigns; queue-backed scheduling"],
          [CheckCircle2,"Completed",completedCount,"Campaigns with finished delivery"],
        ].map(([Icon,label,value,copy],index)=>{const C=Icon as typeof Clock3;return <article key={String(label)} className={`metric-card surface-lift p-4 reveal reveal-delay-${index+1}`}><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">{String(label)}</p><p className="metric-value mt-2 text-2xl font-black">{Number(value).toLocaleString()}</p></div><div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/[.08] text-[var(--accent)]"><C className="h-4 w-4"/></div></div><p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">{String(copy)}</p></article>})}
      </section>

      <section className="mb-4 overflow-hidden rounded-2xl border border-violet-500/15 bg-violet-500/[0.045]">
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><Shuffle className="h-5 w-5"/></div>
            <div><p className="text-sm font-black">Fair multi-campaign delivery</p><p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">Multiple campaigns can send together. NexiMail rotates the release and transport queue round-robin so one large campaign cannot starve the others.</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="status-pill">Round-robin</span>
            <span className="status-pill">{sendingCount} active campaigns</span>
            <span className="status-pill">{deliverySettings.campaignBurstPerRound} message{deliverySettings.campaignBurstPerRound===1?"":"s"} / turn</span>
          </div>
        </div>
      </section>

      <section className="section-card overflow-hidden">
        <div className="section-card-header flex-col items-stretch sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-extrabold">Campaign workspace</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{rows.length ? `${rows.length} recent campaign${rows.length === 1 ? "" : "s"}` : "No campaigns yet"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2"><span className="status-pill"><Radio className="h-3.5 w-3.5"/>Delivery status</span><span className="status-pill">Refresh page for latest</span></div>
        </div>

        {rows.length ? (
          <>
            <div className="divide-y divide-[var(--border)] sm:hidden">
              {rows.map((row) => (
                <Link key={row.id} href={`/campaigns/${row.id}`} className="interactive-row block p-4 active:bg-[var(--surface-soft)]">
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
                  {row.status==="sending" && activeStatMap.get(row.id) ? (()=>{const stat=activeStatMap.get(row.id)!;const done=Math.max(0,stat.total-stat.active);const pct=stat.total?Math.min(100,done/stat.total*100):0;return <div className="mt-3"><div className="mb-1 flex items-center justify-between text-[10px] font-bold text-[var(--muted)]"><span>Live delivery</span><span>{done.toLocaleString()} / {stat.total.toLocaleString()}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-violet-500" style={{width:`${pct}%`}}/></div></div>})() : null}
                  <p className="mt-2 text-[11px] text-[var(--muted)]">Created {new Intl.DateTimeFormat("en",{day:"2-digit",month:"short",year:"numeric",timeZone:"Asia/Kolkata"}).format(row.createdAt)}</p>
                </Link>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[980px] text-left text-xs">
                <thead className="bg-[var(--surface-soft)] text-[11px] font-black uppercase tracking-[.13em] text-[var(--muted)]">
                  <tr><th className="px-4 py-3">Campaign</th><th className="px-5 py-3.5">Subject</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5">Delivery</th><th className="px-5 py-3.5">Schedule</th><th className="px-5 py-3.5">Created</th><th className="px-5 py-3.5" /></tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {rows.map((row) => (
                    <tr key={row.id} className="interactive-row">
                      <td className="px-4 py-3 font-extrabold"><Link href={`/campaigns/${row.id}`} className="hover:text-violet-700 dark:hover:text-violet-300">{row.name}</Link></td>
                      <td className="max-w-[320px] truncate px-5 py-4 text-[var(--muted)]">{row.subject}</td>
                      <td className="px-5 py-4"><span className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold capitalize ${statusClass(row.status)}`}>{row.status}</span></td>
                      <td className="min-w-[150px] px-5 py-4">{row.status==="sending" && activeStatMap.get(row.id) ? (()=>{const stat=activeStatMap.get(row.id)!;const done=Math.max(0,stat.total-stat.active);const pct=stat.total?Math.min(100,done/stat.total*100):0;return <div><div className="flex justify-between gap-2 text-[10px] font-bold text-[var(--muted)]"><span>{pct.toFixed(1)}%</span><span>{stat.active.toLocaleString()} active</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-violet-500" style={{width:`${pct}%`}}/></div></div>})() : <span className="text-[11px] text-[var(--muted)]">—</span>}</td>
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
