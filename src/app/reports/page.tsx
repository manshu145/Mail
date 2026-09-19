import Link from "next/link";
import { Activity, ArrowUpRight, BarChart3, CalendarDays, Eye, MailCheck, MousePointerClick, ShieldCheck, Sparkles, Users, Zap } from "lucide-react";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { MessageStatusBadge } from "@/components/message-status-badge";
import { db, databaseConfigured } from "@/db";
import { getSession } from "@/lib/auth";
import { providerForEmail, providerLabel } from "@/lib/provider";

type Period="all"|"today"|"yesterday"|"7d"|"30d"|"custom";
const validPeriods=new Set<Period>(["all","today","yesterday","7d","30d","custom"]);

function istDate(value:Date){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(value);
}
function dateOnly(value:string|undefined){ return value&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:""; }
function rangeFor(period:Period,from:string,to:string){
  const today=istDate(new Date());
  const yesterday=istDate(new Date(Date.now()-86400000));
  if(period==="today")return {start:today,end:today,label:"Today"};
  if(period==="yesterday")return {start:yesterday,end:yesterday,label:"Yesterday"};
  if(period==="7d")return {start:istDate(new Date(Date.now()-6*86400000)),end:today,label:"Last 7 days"};
  if(period==="30d")return {start:istDate(new Date(Date.now()-29*86400000)),end:today,label:"Last 30 days"};
  if(period==="custom"){
    const start=dateOnly(from)||today; const end=dateOnly(to)||start;
    return start<=end?{start,end,label:start===end?start:`${start} → ${end}`}:{start:end,end:start,label:`${end} → ${start}`};
  }
  return {start:"",end:"",label:"All time"};
}
const fmt=(value:unknown)=>value?new Intl.DateTimeFormat("en-IN",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(new Date(String(value))):"—";
const clamp=(value:number)=>Math.max(0,Math.min(100,value));

export default async function ReportsPage({searchParams}:{searchParams:Promise<{period?:string;from?:string;to?:string}>}){
  const session=await getSession(); if(!session)redirect("/login");
  const qp=await searchParams;
  const period=validPeriods.has(qp.period as Period)?qp.period as Period:"all";
  const range=rangeFor(period,qp.from||"",qp.to||"");
  const timeWhere=range.start
    ? sql`m.queued_at >= (${range.start}::date::timestamp at time zone 'Asia/Kolkata') and m.queued_at < ((${range.end}::date + interval '1 day') at time zone 'Asia/Kolkata')`
    : sql`true`;

  let delivered=0,bounced=0,failed=0,inFlight=0,opens=0,clicks=0,automatedOpens=0,automatedClicks=0,complaints=0,unsubs=0,total=0,dbError=false;
  let recent:Array<Record<string,unknown>>=[]; let campaigns:Array<Record<string,unknown>>=[]; let providerRows:Array<Record<string,unknown>>=[]; let daily:Array<Record<string,unknown>>=[]; let links:Array<Record<string,unknown>>=[];

  if(databaseConfigured)try{
    const [summary,engagement,recentResult,campaignResult,providerResult,dailyResult,linkResult]=await Promise.all([
      db.execute(sql`select count(*)::int total,
        count(*) filter(where m.status='delivered')::int delivered,
        count(*) filter(where m.status='bounced')::int bounced,
        count(*) filter(where m.status='failed')::int failed,
        count(*) filter(where m.status in ('queued','ready_for_transport','sending','mta_accepted','deferred'))::int in_flight
        from messages m where ${timeWhere}`),
      db.execute(sql`select
        count(distinct e.message_id) filter(where e.type='open' and coalesce((e.payload->>'automated')::boolean,false)=false)::int opens,
        count(distinct e.message_id) filter(where e.type='click' and coalesce((e.payload->>'automated')::boolean,false)=false)::int clicks,
        count(*) filter(where e.type='open' and coalesce((e.payload->>'automated')::boolean,false)=true)::int automated_opens,
        count(*) filter(where e.type='click' and coalesce((e.payload->>'automated')::boolean,false)=true)::int automated_clicks,
        count(distinct e.message_id) filter(where e.type='complaint')::int complaints,
        count(distinct e.message_id) filter(where e.type='unsubscribe')::int unsubs
        from message_events e join messages m on m.id=e.message_id where ${timeWhere}`),
      db.execute(sql`select m.id::text,m.recipient_email,m.status::text,m.queued_at,m.delivered_at,m.last_error
        from messages m where ${timeWhere} order by m.queued_at desc limit 30`),
      db.execute(sql`
        select c.id::text campaign_id,c.name campaign_name,c.status::text campaign_status,
          count(m.id)::int targeted,
          count(m.id) filter(where m.status='delivered')::int delivered,
          count(m.id) filter(where m.status='bounced')::int bounced,
          count(m.id) filter(where m.status='failed')::int failed,
          count(distinct e.message_id) filter(where e.type='open' and coalesce((e.payload->>'automated')::boolean,false)=false)::int unique_opens,
          count(distinct e.message_id) filter(where e.type='click' and coalesce((e.payload->>'automated')::boolean,false)=false)::int unique_clicks
        from campaigns c join messages m on m.campaign_id=c.id left join message_events e on e.message_id=m.id
        where ${timeWhere} group by c.id,c.name,c.status,c.created_at order by max(m.queued_at) desc limit 50
      `),
      db.execute(sql`select lower(split_part(m.recipient_email,'@',2)) domain,
        count(*)::int total,
        count(*) filter(where m.status='delivered')::int delivered,
        count(*) filter(where m.status in ('queued','ready_for_transport','sending','mta_accepted','deferred'))::int pending,
        count(*) filter(where m.status='bounced')::int bounced,
        count(*) filter(where m.status='failed')::int failed
        from messages m where ${timeWhere} group by 1 order by count(*) desc limit 100`),
      db.execute(sql`select (m.queued_at at time zone 'Asia/Kolkata')::date::text as day,
        count(*)::int created,
        count(*) filter(where m.status='delivered')::int delivered,
        count(*) filter(where m.status in ('queued','ready_for_transport','sending','mta_accepted','deferred'))::int pending,
        count(*) filter(where m.status='bounced')::int bounced,
        count(*) filter(where m.status='failed')::int failed
        from messages m where ${timeWhere} group by 1 order by 1 desc limit 90`),
      db.execute(sql`select e.payload->>'url' url,count(*)::int clicks,count(distinct e.message_id)::int unique_clickers
        from message_events e join messages m on m.id=e.message_id
        where ${timeWhere} and e.type='click' and coalesce((e.payload->>'automated')::boolean,false)=false and nullif(e.payload->>'url','') is not null
        group by 1 order by clicks desc limit 20`)
    ]);

    const s=(summary.rows[0]||{}) as Record<string,unknown>; const e=(engagement.rows[0]||{}) as Record<string,unknown>;
    total=Number(s.total||0);delivered=Number(s.delivered||0);bounced=Number(s.bounced||0);failed=Number(s.failed||0);inFlight=Number(s.in_flight||0);
    opens=Number(e.opens||0);clicks=Number(e.clicks||0);automatedOpens=Number(e.automated_opens||0);automatedClicks=Number(e.automated_clicks||0);complaints=Number(e.complaints||0);unsubs=Number(e.unsubs||0);
    recent=recentResult.rows as Array<Record<string,unknown>>; campaigns=campaignResult.rows as Array<Record<string,unknown>>; providerRows=providerResult.rows as Array<Record<string,unknown>>; daily=dailyResult.rows as Array<Record<string,unknown>>; links=linkResult.rows as Array<Record<string,unknown>>;
  }catch(error){console.error("[reports]",error);dbError=true}

  const usable=databaseConfigured&&!dbError; const finalized=delivered+bounced+failed;
  const pct=(n:number,d:number)=>d?n/d*100:0;
  const deliveryRate=pct(delivered,finalized),openRate=pct(opens,delivered),clickRate=pct(clicks,delivered),bounceRate=pct(bounced,finalized);

  const providerMap=new Map<string,{total:number;delivered:number;pending:number;bounced:number;failed:number}>();
  for(const raw of providerRows){
    const p=providerForEmail(`x@${String(raw.domain||"unknown")}`); const x=providerMap.get(p)||{total:0,delivered:0,pending:0,bounced:0,failed:0};
    x.total+=Number(raw.total||0);x.delivered+=Number(raw.delivered||0);x.pending+=Number(raw.pending||0);x.bounced+=Number(raw.bounced||0);x.failed+=Number(raw.failed||0); providerMap.set(p,x);
  }
  const providers=[...providerMap.entries()].sort((a,b)=>b[1].total-a[1].total);
  const journey=[
    {label:"Recipients",value:total,icon:Users,rate:100},
    {label:"Delivered",value:delivered,icon:MailCheck,rate:pct(delivered,total)},
    {label:"Opened",value:opens,icon:Eye,rate:pct(opens,delivered)},
    {label:"Clicked",value:clicks,icon:MousePointerClick,rate:pct(clicks,delivered)},
  ];
  const rateStats=[
    {label:"Delivery rate",value:deliveryRate,icon:MailCheck},
    {label:"Open rate",value:openRate,icon:Eye},
    {label:"Click rate",value:clickRate,icon:MousePointerClick},
    {label:"Bounce rate",value:bounceRate,icon:ShieldCheck},
  ];

  return <AppShell session={session}>
    <div className="page-intro">
      <div><div className="mb-2 flex items-center gap-2"><p className="page-eyebrow">Analytics</p><span className="status-pill"><Sparkles className="h-3 w-3"/>Interactive report</span></div><h1 className="page-title">Reports</h1><p className="page-description">Delivery and engagement for <b className="text-[var(--foreground)]">{range.label}</b>. All boundaries use IST.</p></div>
      <form className="section-card flex flex-wrap items-end gap-2 p-2.5">
        <label><span className="mb-1 block text-[9px] font-black uppercase tracking-[.12em] text-[var(--muted)]">Period</span><select name="period" defaultValue={period} className="form-control !min-h-9 !w-auto !py-1.5 text-xs"><option value="all">All time</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom</option></select></label>
        <label><span className="mb-1 block text-[9px] font-black uppercase tracking-[.12em] text-[var(--muted)]">From</span><input type="date" name="from" defaultValue={range.start} className="form-control !min-h-9 !w-auto !py-1.5 text-xs"/></label>
        <label><span className="mb-1 block text-[9px] font-black uppercase tracking-[.12em] text-[var(--muted)]">To</span><input type="date" name="to" defaultValue={range.end} className="form-control !min-h-9 !w-auto !py-1.5 text-xs"/></label>
        <button className="btn-secondary !min-h-9 !px-3 text-xs"><CalendarDays className="h-4 w-4"/>Apply</button>
      </form>
    </div>

    {!usable?<div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Reports are temporarily unavailable.</b></div>:null}

    {usable&&<>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {journey.map(({label,value,icon:Icon},index)=><article key={label} className={`metric-card surface-lift p-5 reveal reveal-delay-${Math.min(index+1,4)}`}><div className="flex items-start justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]">{label}</p><p className="metric-value mt-2 text-3xl font-black">{value.toLocaleString()}</p></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/[.08] text-[var(--accent)]"><Icon className="h-4.5 w-4.5"/></div></div>{index>0?<div className="mt-4 flex items-center gap-2 text-[10px] font-bold text-[var(--muted)]"><Zap className="h-3 w-3 text-[var(--accent)]"/>{journey[index].rate.toFixed(1)}% of previous stage</div>:<div className="mt-4 text-[10px] font-bold text-[var(--muted)]">Audience in selected period</div>}</article>)}
      </section>

      <section className="section-card mt-4 p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3"><div><p className="page-eyebrow">Journey</p><h2 className="section-card-title mt-1">From recipient to click</h2></div><span className="status-pill"><Activity className="h-3 w-3"/>Live metrics</span></div>
        <div className="grid gap-3 md:grid-cols-4">
          {journey.map(({label,value,rate},index)=><div key={label} className="relative rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"><div className="flex items-center justify-between"><span className="text-[11px] font-extrabold text-[var(--muted)]">{label}</span><span className="text-[10px] font-black text-[var(--accent)]">{index===0?"100%":rate.toFixed(1)+"%"}</span></div><p className="metric-value mt-2 text-2xl font-black">{value.toLocaleString()}</p><div className="progress-track mt-3"><div className="progress-fill" style={{width:`${index===0?100:clamp(rate)}%`}}/></div>{index<journey.length-1?<ArrowUpRight className="absolute -right-2.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 rotate-45 rounded-full bg-[var(--surface)] p-1 text-[var(--accent)] shadow md:block"/>:null}</div>)}
        </div>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rateStats.map(({label,value,icon:Icon})=><article key={label} className="section-card surface-lift p-4"><div className="flex items-center justify-between"><div><p className="text-[11px] font-bold text-[var(--muted)]">{label}</p><p className="metric-value mt-1 text-[22px] font-black">{value.toFixed(2)}%</p></div><div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Icon className="h-4 w-4"/></div></div><div className="progress-track mt-3"><div className="progress-fill" style={{width:`${clamp(value)}%`}}/></div></article>)}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <article className="section-card p-5"><p className="page-eyebrow">Delivery health</p><h2 className="section-card-title mt-1">Current outcome mix</h2><div className="mt-5 space-y-4">{[["Delivered",delivered,"bg-emerald-500"],["In progress",inFlight,"bg-violet-500"],["Bounced",bounced,"bg-amber-500"],["Failed",failed,"bg-rose-500"]].map(([l,v,color])=>{const count=Number(v),rate=pct(count,total);return <div key={String(l)}><div className="mb-1.5 flex justify-between text-xs"><span className="font-bold">{l}</span><span className="font-black">{count.toLocaleString()} <span className="font-bold text-[var(--muted)]">· {rate.toFixed(1)}%</span></span></div><div className="h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className={`h-full rounded-full ${color}`} style={{width:`${clamp(rate)}%`}}/></div></div>})}</div></article>
        <article className="section-card p-5"><p className="page-eyebrow">Engagement & compliance</p><h2 className="section-card-title mt-1">Human activity vs system signals</h2><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">{[["Unique opens",opens],["Unique clicks",clicks],["Automated opens",automatedOpens],["Automated clicks",automatedClicks],["Complaints",complaints],["Unsubscribes",unsubs]].map(([l,v])=><div key={String(l)} className="panel-soft p-4"><p className="text-[10px] font-bold leading-4 text-[var(--muted)]">{l}</p><p className="metric-value mt-2 text-xl font-black">{Number(v).toLocaleString()}</p></div>)}</div></article>
      </section>

      <section className="section-card mt-5 overflow-hidden">
        <div className="section-card-header"><div><h2 className="section-card-title">Mailbox provider performance</h2><p className="section-card-copy">See whether outcomes differ by destination network.</p></div></div>
        <div className="desktop-table-only overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Provider</th><th>Total</th><th>Delivered</th><th>In progress</th><th>Bounced</th><th>Failed</th></tr></thead><tbody>{providers.length?providers.map(([p,x])=><tr key={p} className="interactive-row border-t border-[var(--border)]"><td className="px-5 py-3 font-bold">{providerLabel(p)}</td><td>{x.total}</td><td>{x.delivered}</td><td>{x.pending}</td><td>{x.bounced}</td><td>{x.failed}</td></tr>):<tr><td colSpan={6} className="p-8 text-center text-[var(--muted)]">No provider data in this period.</td></tr>}</tbody></table></div>
        <div className="mobile-card-list p-3">{providers.length?providers.map(([p,x])=><article key={p} className="panel-soft p-4"><div className="flex items-center justify-between"><b className="text-sm">{providerLabel(p)}</b><span className="status-pill">{x.total.toLocaleString()} total</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><span className="text-[var(--muted)]">Delivered <b className="float-right text-[var(--foreground)]">{x.delivered}</b></span><span className="text-[var(--muted)]">Pending <b className="float-right text-[var(--foreground)]">{x.pending}</b></span><span className="text-[var(--muted)]">Bounced <b className="float-right text-[var(--foreground)]">{x.bounced}</b></span><span className="text-[var(--muted)]">Failed <b className="float-right text-[var(--foreground)]">{x.failed}</b></span></div></article>):<div className="p-6 text-center text-sm text-[var(--muted)]">No provider data.</div>}</div>
      </section>

      <section className="section-card mt-5 overflow-hidden">
        <div className="section-card-header"><div><h2 className="section-card-title">Campaign performance</h2><p className="section-card-copy">Compare campaign outcomes in the selected period.</p></div></div>
        {campaigns.length?<><div className="desktop-table-only overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Campaign</th><th>Status</th><th>Targeted</th><th>Delivered</th><th>Opens</th><th>Clicks</th><th>Bounce</th><th>Failed</th></tr></thead><tbody>{campaigns.map(c=>{const targeted=Number(c.targeted||0),del=Number(c.delivered||0),bo=Number(c.bounced||0),fa=Number(c.failed||0);return <tr className="interactive-row border-t border-[var(--border)]" key={String(c.campaign_id)}><td className="px-5 py-3.5"><Link className="font-bold hover:text-[var(--accent)]" href={`/campaigns/${String(c.campaign_id)}`}>{String(c.campaign_name)}</Link></td><td className="capitalize">{String(c.campaign_status)}</td><td>{targeted.toLocaleString()}</td><td>{del.toLocaleString()}</td><td>{Number(c.unique_opens||0).toLocaleString()}</td><td>{Number(c.unique_clicks||0).toLocaleString()}</td><td>{pct(bo,del+bo+fa).toFixed(2)}%</td><td>{fa.toLocaleString()}</td></tr>})}</tbody></table></div><div className="mobile-card-list p-3">{campaigns.map(c=>{const targeted=Number(c.targeted||0),del=Number(c.delivered||0);return <Link href={`/campaigns/${String(c.campaign_id)}`} key={String(c.campaign_id)} className="panel-soft block p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black">{String(c.campaign_name)}</p><p className="mt-1 text-[11px] capitalize text-[var(--muted)]">{String(c.campaign_status)}</p></div><ArrowUpRight className="h-4 w-4 text-[var(--muted)]"/></div><div className="mt-3 flex items-center justify-between text-xs"><span className="text-[var(--muted)]">Delivered</span><b>{del.toLocaleString()} / {targeted.toLocaleString()}</b></div><div className="progress-track mt-2"><div className="progress-fill" style={{width:`${clamp(pct(del,targeted))}%`}}/></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]"><div><b className="block text-sm">{Number(c.unique_opens||0)}</b><span className="text-[var(--muted)]">Opens</span></div><div><b className="block text-sm">{Number(c.unique_clicks||0)}</b><span className="text-[var(--muted)]">Clicks</span></div><div><b className="block text-sm">{Number(c.bounced||0)}</b><span className="text-[var(--muted)]">Bounces</span></div></div></Link>})}</div></>:<div className="p-10 text-center text-sm text-[var(--muted)]">No campaign data in this period.</div>}
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <article className="section-card overflow-hidden"><div className="section-card-header"><div><h2 className="section-card-title">Daily delivery trend</h2><p className="section-card-copy">Recent daily throughput and outcomes.</p></div></div><div className="divide-y divide-[var(--border)]">{daily.slice(0,14).length?daily.slice(0,14).map(x=>{const created=Number(x.created||0),del=Number(x.delivered||0);return <div key={String(x.day)} className="interactive-row p-4"><div className="flex items-center justify-between text-xs"><b>{String(x.day)}</b><span className="text-[var(--muted)]">{del.toLocaleString()} / {created.toLocaleString()} delivered</span></div><div className="progress-track mt-2"><div className="progress-fill" style={{width:`${clamp(pct(del,created))}%`}}/></div><div className="mt-2 flex gap-3 text-[10px] text-[var(--muted)]"><span>{Number(x.pending||0)} pending</span><span>{Number(x.bounced||0)} bounced</span><span>{Number(x.failed||0)} failed</span></div></div>}):<div className="p-8 text-center text-sm text-[var(--muted)]">No delivery data.</div>}</div></article>
        <article className="section-card overflow-hidden"><div className="section-card-header"><div><h2 className="section-card-title">Top clicked links</h2><p className="section-card-copy">Verified human click activity.</p></div></div><div className="divide-y divide-[var(--border)]">{links.length?links.map((x,index)=><div key={String(x.url)} className="interactive-row flex items-start gap-3 p-4"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-xs font-black text-[var(--accent)]">{index+1}</div><a href={String(x.url)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 break-all text-xs font-bold hover:text-[var(--accent)]">{String(x.url)}</a><div className="shrink-0 text-right text-[10px]"><b className="block text-xs">{Number(x.unique_clickers||0)} people</b><span className="text-[var(--muted)]">{Number(x.clicks||0)} clicks</span></div></div>):<div className="p-8 text-center text-sm text-[var(--muted)]">No verified clicks.</div>}</div></article>
      </section>

      <section className="section-card mt-5 overflow-hidden"><div className="section-card-header"><div><h2 className="section-card-title">Recipient activity</h2><p className="section-card-copy">Latest 30 messages in the selected period.</p></div></div>{recent.length?<><div className="desktop-table-only overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3.5">Recipient</th><th>Status</th><th>Queued</th><th>Delivered</th><th>Detail</th></tr></thead><tbody>{recent.map(m=><tr key={String(m.id)} className="interactive-row border-t border-[var(--border)]"><td className="px-5 py-4"><Link href={`/messages/${String(m.id)}`} className="font-bold hover:text-[var(--accent)]">{String(m.recipient_email)}</Link></td><td><MessageStatusBadge status={String(m.status)} compact/></td><td className="text-xs text-[var(--muted)]">{fmt(m.queued_at)}</td><td className="text-xs text-[var(--muted)]">{fmt(m.delivered_at)}</td><td className="max-w-[300px] truncate text-xs text-[var(--muted)]">{String(m.last_error||"—")}</td></tr>)}</tbody></table></div><div className="mobile-card-list p-3">{recent.map(m=><Link href={`/messages/${String(m.id)}`} key={String(m.id)} className="panel-soft block p-4"><div className="flex items-center justify-between gap-2"><p className="min-w-0 truncate text-xs font-black">{String(m.recipient_email)}</p><MessageStatusBadge status={String(m.status)} compact/></div><div className="mt-2 flex justify-between text-[10px] text-[var(--muted)]"><span>Queued {fmt(m.queued_at)}</span><ArrowUpRight className="h-3.5 w-3.5"/></div></Link>)}</div></>:<div className="p-10 text-center text-sm text-[var(--muted)]">No recipient activity in this period.</div>}</section>
    </>}
  </AppShell>;
}
