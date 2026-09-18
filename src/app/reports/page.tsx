import Link from "next/link";
import { BarChart3, MailCheck, MousePointerClick, Users } from "lucide-react";
import { redirect } from "next/navigation";
import { desc, sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { MessageStatusBadge } from "@/components/message-status-badge";
import { LiveRefresh } from "@/components/live-refresh";
import { db, databaseConfigured } from "@/db";
import { messageEvents, messages } from "@/db/schema";
import { providerCooldowns } from "@/db/operations-schema";
import { getCampaignMetricsList } from "@/lib/campaign-reporting";
import { getSession } from "@/lib/auth";
import { providerForEmail, providerLabel } from "@/lib/provider";

export default async function ReportsPage(){
  const session=await getSession();
  if(!session)redirect("/login");
  let delivered=0,bounced=0,deferred=0,accepted=0,failed=0,inFlight=0,opens=0,clicks=0,automatedOpens=0,automatedClicks=0,complaints=0,unsubs=0,total=0,dbError=false;
  let recent:typeof messages.$inferSelect[]=[];
  let campaigns:Awaited<ReturnType<typeof getCampaignMetricsList>>=[];
  let providerRows:Record<string,unknown>[]=[]; let daily:Record<string,unknown>[]=[]; let links:Record<string,unknown>[]=[]; let cooldowns:typeof providerCooldowns.$inferSelect[]=[];
  const supplementalErrors:string[]=[];
  if(databaseConfigured)try{
    const [summary,engagement,r,cm]=await Promise.all([
      db.execute(sql`select count(*)::int total,
        count(*) filter(where status='delivered')::int delivered,
        count(*) filter(where status='bounced')::int bounced,
        count(*) filter(where status='deferred')::int deferred,
        count(*) filter(where status='mta_accepted')::int accepted,
        count(*) filter(where status='failed')::int failed,
        count(*) filter(where status in ('queued','ready_for_transport','sending','mta_accepted','deferred'))::int in_flight
        from messages`),
      db.execute(sql`select
        count(distinct message_id) filter(where type='open' and coalesce((payload->>'automated')::boolean,false)=false)::int opens,
        count(distinct message_id) filter(where type='click' and coalesce((payload->>'automated')::boolean,false)=false)::int clicks,
        count(*) filter(where type='open' and coalesce((payload->>'automated')::boolean,false)=true)::int automated_opens,
        count(*) filter(where type='click' and coalesce((payload->>'automated')::boolean,false)=true)::int automated_clicks,
        count(distinct message_id) filter(where type='complaint')::int complaints,
        count(distinct message_id) filter(where type='unsubscribe')::int unsubs
        from message_events`),
      db.select().from(messages).orderBy(desc(messages.queuedAt)).limit(30),
      getCampaignMetricsList(30),
    ]);
    const s=(summary.rows[0]||{}) as Record<string,unknown>; const e=(engagement.rows[0]||{}) as Record<string,unknown>;
    total=Number(s.total||0);delivered=Number(s.delivered||0);bounced=Number(s.bounced||0);deferred=Number(s.deferred||0);accepted=Number(s.accepted||0);failed=Number(s.failed||0);inFlight=Number(s.in_flight||0);
    opens=Number(e.opens||0);clicks=Number(e.clicks||0);automatedOpens=Number(e.automated_opens||0);automatedClicks=Number(e.automated_clicks||0);complaints=Number(e.complaints||0);unsubs=Number(e.unsubs||0);
    recent=r;campaigns=cm;

    const supplemental=await Promise.allSettled([
      db.execute(sql`select lower(split_part(recipient_email,'@',2)) domain,
        count(*)::int total,
        count(*) filter(where status='delivered')::int delivered,
        count(*) filter(where status='deferred')::int deferred,
        count(*) filter(where status='bounced')::int bounced,
        count(*) filter(where status='failed')::int failed
        from messages group by 1 order by count(*) desc limit 80`),
      db.execute(sql`select (queued_at at time zone 'Asia/Kolkata')::date::text as "day",
        count(*)::int created,
        count(*) filter(where status='delivered')::int delivered,
        count(*) filter(where status='deferred')::int deferred,
        count(*) filter(where status='bounced')::int bounced,
        count(*) filter(where status='failed')::int failed
        from messages where queued_at>=now()-interval '14 days' group by 1 order by 1 desc`),
      db.execute(sql`select payload->>'url' url,count(*)::int clicks,count(distinct message_id)::int unique_clickers
        from message_events where type='click' and coalesce((payload->>'automated')::boolean,false)=false and nullif(payload->>'url','') is not null
        group by 1 order by clicks desc limit 20`),
      db.select().from(providerCooldowns).orderBy(desc(providerCooldowns.updatedAt)).limit(50),
    ]);
    if(supplemental[0].status==="fulfilled")providerRows=supplemental[0].value.rows as Record<string,unknown>[];else supplementalErrors.push("provider performance");
    if(supplemental[1].status==="fulfilled")daily=supplemental[1].value.rows as Record<string,unknown>[];else supplementalErrors.push("delivery trend");
    if(supplemental[2].status==="fulfilled")links=supplemental[2].value.rows as Record<string,unknown>[];else supplementalErrors.push("top links");
    if(supplemental[3].status==="fulfilled")cooldowns=supplemental[3].value;else supplementalErrors.push("provider cooldowns");
    supplemental.forEach((result,index)=>{if(result.status==="rejected")console.error("[reports] supplemental query failed",index,result.reason)});
  }catch(error){console.error("[reports]",error);dbError=true}
  const usable=databaseConfigured&&!dbError;
  const finalized=delivered+bounced+failed;
  const deliveryRate=finalized?delivered/finalized*100:0,openRate=delivered?opens/delivered*100:0,clickRate=delivered?clicks/delivered*100:0,bounceRate=finalized?bounced/finalized*100:0;
  const cards=[{l:"Recipients",v:total,icon:Users,tone:"violet"},{l:"Remote MX accepted",v:delivered,icon:MailCheck,tone:"emerald"},{l:"Unique opens",v:opens,icon:BarChart3,tone:"blue"},{l:"Unique clicks",v:clicks,icon:MousePointerClick,tone:"cyan"}];
  const cardTone:Record<string,string>={violet:"border-violet-500/15 bg-violet-500/[0.025]",emerald:"border-emerald-500/15 bg-emerald-500/[0.025]",blue:"border-blue-500/15 bg-blue-500/[0.025]",cyan:"border-cyan-500/15 bg-cyan-500/[0.025]"};
  const providerMap=new Map<string,{total:number;delivered:number;deferred:number;bounced:number;failed:number}>();
  for(const raw of providerRows){const domain=String(raw.domain||"unknown");const p=providerForEmail(`x@${domain}`);const x=providerMap.get(p)||{total:0,delivered:0,deferred:0,bounced:0,failed:0};x.total+=Number(raw.total||0);x.delivered+=Number(raw.delivered||0);x.deferred+=Number(raw.deferred||0);x.bounced+=Number(raw.bounced||0);x.failed+=Number(raw.failed||0);providerMap.set(p,x)}
  const providers=[...providerMap.entries()].sort((a,b)=>b[1].total-a[1].total);
  const activeCooldowns=cooldowns.filter(c=>c.active);
  return <AppShell session={session}>
    <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-extrabold uppercase tracking-[.18em] text-zinc-400">Analytics</p><h1 className="text-3xl font-black tracking-[-.035em] sm:text-4xl">Reports</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">Delivery, provider health, unique engagement and recipient-level transport truth. Known automated scanners/previews remain separated from human activity.</p></div><LiveRefresh intervalMs={10000} label="Live metrics"/></div>
    {!usable?<div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>{databaseConfigured ? "Reports could not be loaded." : "Database is not configured."}</b> {databaseConfigured ? "A reporting query failed. Check the application logs for details; unavailable metrics are not shown as zero." : "Configure the database connection to load analytics."}</div>:null}
    {usable && supplementalErrors.length ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Some supplemental analytics are unavailable:</b> {supplementalErrors.join(", ")}. Core delivery and engagement metrics are still live.</div> : null}
    {usable && <>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({l,v,icon:Icon,tone})=><article key={l} className={`premium-panel p-5 ${cardTone[tone]}`}><div className="flex justify-between"><p className="text-sm font-bold text-zinc-500">{l}</p><Icon className="h-5 w-5 text-zinc-400"/></div><p className="mt-3 text-3xl font-black">{v.toLocaleString()}</p></article>)}</section>
    <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Delivery rate (finalized)",deliveryRate],["Open rate",openRate],["Click rate",clickRate],["Bounce rate (finalized)",bounceRate]].map(([l,v])=><article key={String(l)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"><p className="text-xs font-bold text-[var(--muted)]">{l}</p><p className="mt-1 text-2xl font-black">{Number(v).toFixed(2)}%</p></article>)}</section>
    <p className="mt-2 text-[11px] text-[var(--muted)]">Delivery and bounce rates use finalized remote outcomes only (remote accepted + bounced + failed). Queued/in-flight messages do not depress the rate while a campaign is still running.</p>
    <section className="mt-5 grid gap-5 xl:grid-cols-2"><article className="premium-panel p-6"><p className="text-xs font-extrabold uppercase tracking-[.16em] text-zinc-400">Delivery state</p><div className="mt-5 space-y-3">{[["Remote MX accepted",delivered],["In flight",inFlight],["Local MTA accepted",accepted],["Deferred",deferred],["Bounced",bounced],["Failed",failed]].map(([l,v])=><div key={String(l)} className="flex justify-between rounded-xl border border-zinc-100 px-4 py-3 dark:border-zinc-800"><span className="text-sm font-bold">{l}</span><span className="font-black">{Number(v).toLocaleString()}</span></div>)}</div></article><article className="premium-panel p-6"><p className="text-xs font-extrabold uppercase tracking-[.16em] text-zinc-400">Engagement & compliance</p><div className="mt-5 grid grid-cols-2 gap-3">{[["Unique opens",opens],["Unique clicks",clicks],["Automated opens",automatedOpens],["Automated clicks",automatedClicks],["Complaints",complaints],["Unsubscribes",unsubs]].map(([l,v])=><div key={String(l)} className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900"><p className="text-xs font-bold text-zinc-400">{l}</p><p className="mt-2 text-2xl font-black">{Number(v).toLocaleString()}</p></div>)}</div></article></section>

    <section className="premium-panel mt-5 overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Provider performance & cooldowns</h2><p className="mt-1 text-xs text-[var(--muted)]">Provider cooldowns are reserved for temporary provider pressure such as throttling/rate-limit responses; single permanent content/policy rejections do not pause a provider.</p></div><div className="grid gap-5 p-5 xl:grid-cols-[1.4fr_.6fr]"><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th>Provider</th><th>Total</th><th>Remote accepted</th><th>Deferred</th><th>Bounced</th><th>Failed</th></tr></thead><tbody>{providers.length?providers.map(([p,x])=><tr key={p} className="border-t border-[var(--border)]"><td className="py-3 font-bold">{providerLabel(p)}</td><td>{x.total}</td><td>{x.delivered}</td><td>{x.deferred}</td><td>{x.bounced}</td><td>{x.failed}</td></tr>):<tr><td colSpan={6} className="py-8 text-center text-[var(--muted)]">No provider data yet.</td></tr>}</tbody></table></div><div><h3 className="text-sm font-black">Active cooldowns</h3><div className="mt-3 space-y-2">{activeCooldowns.length?activeCooldowns.map(c=><div key={c.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200"><b>{providerLabel(c.provider)}</b><div className="mt-1">Next probe: {c.nextProbeAt?new Intl.DateTimeFormat("en",{dateStyle:"short",timeStyle:"short"}).format(c.nextProbeAt):"due now"}</div><div className="mt-1 break-words opacity-80">{c.reason||c.lastResponse||"Provider pressure detected"}</div></div>):<div className="rounded-xl bg-emerald-500/10 p-4 text-xs font-bold text-emerald-700 dark:text-emerald-300">No active provider cooldowns.</div>}</div></div></div></section>

    <section className="premium-panel mt-5 overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Campaign performance</h2><p className="mt-1 text-xs text-[var(--muted)]">Finalized remote outcomes and unique engagement by campaign.</p></div>{campaigns.length?<div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Campaign</th><th>Status</th><th>Targeted</th><th>Remote accepted</th><th>Delivery progress</th><th>Opens</th><th>Clicks</th><th>CTOR</th><th>Bounce</th><th>Failed</th></tr></thead><tbody>{campaigns.map(c=><tr className="border-t border-[var(--border)]" key={c.campaignId}><td className="px-5 py-3.5"><Link className="font-bold hover:underline" href={`/campaigns/${c.campaignId}`}>{c.campaignName}</Link></td><td className="capitalize">{c.campaignStatus}</td><td>{c.targeted.toLocaleString()}</td><td>{c.delivered.toLocaleString()}</td><td>{c.deliveryProgressRate.toFixed(2)}%</td><td>{c.uniqueOpens.toLocaleString()}</td><td>{c.uniqueClicks.toLocaleString()}</td><td>{c.ctor.toFixed(2)}%</td><td>{c.bounceRate.toFixed(2)}%</td><td>{c.failed.toLocaleString()}</td></tr>)}</tbody></table></div>:<div className="p-10 text-center text-sm text-[var(--muted)]">No campaign data yet.</div>}</section>

    <section className="mt-5 grid gap-5 xl:grid-cols-2"><article className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">14-day delivery trend</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Day</th><th>Created</th><th>Remote accepted</th><th>Deferred</th><th>Bounced</th><th>Failed</th></tr></thead><tbody>{daily.map(x=><tr key={String(x.day)} className="border-t border-[var(--border)]"><td className="px-5 py-3 font-bold">{String(x.day)}</td><td>{Number(x.created||0)}</td><td>{Number(x.delivered||0)}</td><td>{Number(x.deferred||0)}</td><td>{Number(x.bounced||0)}</td><td>{Number(x.failed||0)}</td></tr>)}</tbody></table></div></article><article className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Top clicked links</h2><p className="mt-1 text-xs text-[var(--muted)]">Verified human click events only.</p></div><div className="divide-y divide-[var(--border)]">{links.length?links.map(x=><div key={String(x.url)} className="flex items-start justify-between gap-4 p-4"><a href={String(x.url)} target="_blank" rel="noreferrer" className="min-w-0 break-all text-sm font-bold text-violet-600 hover:underline">{String(x.url)}</a><div className="shrink-0 text-right text-xs"><b>{Number(x.unique_clickers||0)} people</b><div className="text-[var(--muted)]">{Number(x.clicks||0)} clicks</div></div></div>):<div className="p-8 text-center text-sm text-[var(--muted)]">No verified clicks yet.</div>}</div></article></section>

    <section className="premium-panel mt-5 overflow-hidden"><div className="border-b border-zinc-100 p-5 dark:border-zinc-900"><h2 className="font-black">Recipient activity</h2><p className="mt-1 text-xs text-zinc-500">Latest 30 recipient messages. Click any address for the full person/message timeline.</p></div>{recent.length?<div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-zinc-50 text-[11px] font-extrabold uppercase tracking-[.12em] text-zinc-400 dark:bg-zinc-900/70"><tr><th className="px-5 py-3.5">Recipient</th><th>Status</th><th>Campaign</th><th>Local accepted</th><th>Remote accepted</th><th>Error</th></tr></thead><tbody>{recent.map(m=><tr key={m.id} className="border-t border-zinc-100 dark:border-zinc-900"><td className="px-5 py-4"><Link href={`/messages/${m.id}`} className="font-bold hover:underline">{m.recipientEmail}</Link></td><td><MessageStatusBadge status={m.status} compact /></td><td className="font-mono text-xs text-zinc-500">{m.campaignId.slice(0,8)}</td><td className="text-xs text-zinc-500">{m.acceptedAt?new Intl.DateTimeFormat("en",{dateStyle:"short",timeStyle:"short"}).format(m.acceptedAt):"—"}</td><td className="text-xs text-zinc-500">{m.deliveredAt?new Intl.DateTimeFormat("en",{dateStyle:"short",timeStyle:"short"}).format(m.deliveredAt):"—"}</td><td className="max-w-[220px] truncate text-xs text-rose-500">{m.lastError||"—"}</td></tr>)}</tbody></table></div>:<div className="p-10 text-center text-sm text-zinc-500">No recipient activity yet.</div>}</section>
    </>}
  </AppShell>;
}
