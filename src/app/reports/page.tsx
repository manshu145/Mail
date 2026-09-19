import Link from "next/link";
import { BarChart3, CalendarDays, MailCheck, MousePointerClick, Users } from "lucide-react";
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
function dateOnly(value:string|undefined){
  return value&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:"";
}
function rangeFor(period:Period,from:string,to:string){
  const today=istDate(new Date());
  const yesterday=istDate(new Date(Date.now()-86400000));
  if(period==="today")return {start:today,end:today,label:"Today"};
  if(period==="yesterday")return {start:yesterday,end:yesterday,label:"Yesterday"};
  if(period==="7d"){
    const start=istDate(new Date(Date.now()-6*86400000));
    return {start,end:today,label:"Last 7 days"};
  }
  if(period==="30d"){
    const start=istDate(new Date(Date.now()-29*86400000));
    return {start,end:today,label:"Last 30 days"};
  }
  if(period==="custom"){
    const start=dateOnly(from)||today;
    const end=dateOnly(to)||start;
    return start<=end?{start,end,label:start===end?start:`${start} → ${end}`}:{start:end,end:start,label:`${end} → ${start}`};
  }
  return {start:"",end:"",label:"All time"};
}
const fmt=(value:unknown)=>value?new Intl.DateTimeFormat("en-IN",{dateStyle:"short",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(new Date(String(value))):"—";

export default async function ReportsPage({searchParams}:{searchParams:Promise<{period?:string;from?:string;to?:string}>}){
  const session=await getSession();
  if(!session)redirect("/login");
  const qp=await searchParams;
  const period=validPeriods.has(qp.period as Period)?qp.period as Period:"all";
  const range=rangeFor(period,qp.from||"",qp.to||"");
  const timeWhere=range.start
    ? sql`m.queued_at >= (${range.start}::date::timestamp at time zone 'Asia/Kolkata') and m.queued_at < ((${range.end}::date + interval '1 day') at time zone 'Asia/Kolkata')`
    : sql`true`;

  let delivered=0,bounced=0,failed=0,inFlight=0,opens=0,clicks=0,automatedOpens=0,automatedClicks=0,complaints=0,unsubs=0,total=0,dbError=false;
  let recent:Array<Record<string,unknown>>=[];
  let campaigns:Array<Record<string,unknown>>=[];
  let providerRows:Array<Record<string,unknown>>=[];
  let daily:Array<Record<string,unknown>>=[];
  let links:Array<Record<string,unknown>>=[];

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
        from campaigns c
        join messages m on m.campaign_id=c.id
        left join message_events e on e.message_id=m.id
        where ${timeWhere}
        group by c.id,c.name,c.status,c.created_at
        order by max(m.queued_at) desc
        limit 50
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

    const s=(summary.rows[0]||{}) as Record<string,unknown>;
    const e=(engagement.rows[0]||{}) as Record<string,unknown>;
    total=Number(s.total||0);delivered=Number(s.delivered||0);bounced=Number(s.bounced||0);failed=Number(s.failed||0);inFlight=Number(s.in_flight||0);
    opens=Number(e.opens||0);clicks=Number(e.clicks||0);automatedOpens=Number(e.automated_opens||0);automatedClicks=Number(e.automated_clicks||0);complaints=Number(e.complaints||0);unsubs=Number(e.unsubs||0);
    recent=recentResult.rows as Array<Record<string,unknown>>;
    campaigns=campaignResult.rows as Array<Record<string,unknown>>;
    providerRows=providerResult.rows as Array<Record<string,unknown>>;
    daily=dailyResult.rows as Array<Record<string,unknown>>;
    links=linkResult.rows as Array<Record<string,unknown>>;
  }catch(error){console.error("[reports]",error);dbError=true}

  const usable=databaseConfigured&&!dbError;
  const finalized=delivered+bounced+failed;
  const pct=(n:number,d:number)=>d?n/d*100:0;
  const deliveryRate=pct(delivered,finalized),openRate=pct(opens,delivered),clickRate=pct(clicks,delivered),bounceRate=pct(bounced,finalized);

  const providerMap=new Map<string,{total:number;delivered:number;pending:number;bounced:number;failed:number}>();
  for(const raw of providerRows){
    const p=providerForEmail(`x@${String(raw.domain||"unknown")}`);
    const x=providerMap.get(p)||{total:0,delivered:0,pending:0,bounced:0,failed:0};
    x.total+=Number(raw.total||0);x.delivered+=Number(raw.delivered||0);x.pending+=Number(raw.pending||0);x.bounced+=Number(raw.bounced||0);x.failed+=Number(raw.failed||0);
    providerMap.set(p,x);
  }
  const providers=[...providerMap.entries()].sort((a,b)=>b[1].total-a[1].total);

  return <AppShell session={session}>
    <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="page-eyebrow mb-2">Analytics</p><h1 className="page-title">Reports</h1><p className="page-description">Delivery and engagement for <b>{range.label}</b>. All time boundaries use IST.</p></div>
      <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-2.5">
        <label><span className="mb-1 block text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">Period</span><select name="period" defaultValue={period} className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs font-bold">
          <option value="all">All time</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom</option>
        </select></label>
        <label><span className="mb-1 block text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">From</span><input type="date" name="from" defaultValue={range.start} className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs font-bold"/></label>
        <label><span className="mb-1 block text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">To</span><input type="date" name="to" defaultValue={range.end} className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs font-bold"/></label>
        <button className="btn-secondary !min-h-9 !px-3 text-xs"><CalendarDays className="h-4 w-4"/>Apply</button>
      </form>
    </div>

    {!usable?<div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Reports are temporarily unavailable.</b></div>:null}

    {usable&&<>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[[Users,"Recipients",total],[MailCheck,"Delivered",delivered],[BarChart3,"Unique opens",opens],[MousePointerClick,"Unique clicks",clicks]].map(([Icon,label,value])=>{const C=Icon as typeof Users;return <article key={String(label)} className="premium-panel p-5"><div className="flex justify-between"><p className="text-sm font-bold text-[var(--muted)]">{String(label)}</p><C className="h-5 w-5 text-[var(--muted)]"/></div><p className="mt-3 text-3xl font-black">{Number(value).toLocaleString()}</p></article>})}
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Delivery rate",deliveryRate],["Open rate",openRate],["Click rate",clickRate],["Bounce rate",bounceRate]].map(([l,v])=><article key={String(l)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"><p className="text-xs font-bold text-[var(--muted)]">{l}</p><p className="mt-1 text-2xl font-black">{Number(v).toFixed(2)}%</p></article>)}</section>

      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <article className="premium-panel p-6"><p className="page-eyebrow">Delivery status</p><div className="mt-5 space-y-3">{[["Delivered",delivered],["In progress",inFlight],["Bounced",bounced],["Failed",failed]].map(([l,v])=><div key={String(l)} className="flex justify-between rounded-xl border border-[var(--border)] px-4 py-3"><span className="text-sm font-bold">{l}</span><span className="font-black">{Number(v).toLocaleString()}</span></div>)}</div></article>
        <article className="premium-panel p-6"><p className="page-eyebrow">Engagement & compliance</p><div className="mt-5 grid grid-cols-2 gap-3">{[["Unique opens",opens],["Unique clicks",clicks],["Automated opens",automatedOpens],["Automated clicks",automatedClicks],["Complaints",complaints],["Unsubscribes",unsubs]].map(([l,v])=><div key={String(l)} className="rounded-2xl bg-[var(--surface-soft)] p-5"><p className="text-xs font-bold text-[var(--muted)]">{l}</p><p className="mt-2 text-2xl font-black">{Number(v).toLocaleString()}</p></div>)}</div></article>
      </section>

      <section className="premium-panel mt-5 overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Mailbox provider performance</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[11px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Provider</th><th>Total</th><th>Delivered</th><th>In progress</th><th>Bounced</th><th>Failed</th></tr></thead><tbody>{providers.length?providers.map(([p,x])=><tr key={p} className="border-t border-[var(--border)]"><td className="px-5 py-3 font-bold">{providerLabel(p)}</td><td>{x.total}</td><td>{x.delivered}</td><td>{x.pending}</td><td>{x.bounced}</td><td>{x.failed}</td></tr>):<tr><td colSpan={6} className="p-8 text-center text-[var(--muted)]">No provider data in this period.</td></tr>}</tbody></table></div></section>

      <section className="premium-panel mt-5 overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Campaign performance</h2></div>{campaigns.length?<div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[11px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Campaign</th><th>Status</th><th>Targeted</th><th>Delivered</th><th>Opens</th><th>Clicks</th><th>Bounce</th><th>Failed</th></tr></thead><tbody>{campaigns.map(c=>{const targeted=Number(c.targeted||0),del=Number(c.delivered||0),bo=Number(c.bounced||0),fa=Number(c.failed||0);return <tr className="border-t border-[var(--border)]" key={String(c.campaign_id)}><td className="px-5 py-3.5"><Link className="font-bold hover:underline" href={`/campaigns/${String(c.campaign_id)}`}>{String(c.campaign_name)}</Link></td><td className="capitalize">{String(c.campaign_status)}</td><td>{targeted.toLocaleString()}</td><td>{del.toLocaleString()}</td><td>{Number(c.unique_opens||0).toLocaleString()}</td><td>{Number(c.unique_clicks||0).toLocaleString()}</td><td>{pct(bo,del+bo+fa).toFixed(2)}%</td><td>{fa.toLocaleString()}</td></tr>})}</tbody></table></div>:<div className="p-10 text-center text-sm text-[var(--muted)]">No campaign data in this period.</div>}</section>

      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <article className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Daily delivery trend</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[11px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Day</th><th>Created</th><th>Delivered</th><th>In progress</th><th>Bounced</th><th>Failed</th></tr></thead><tbody>{daily.length?daily.map(x=><tr key={String(x.day)} className="border-t border-[var(--border)]"><td className="px-5 py-3 font-bold">{String(x.day)}</td><td>{Number(x.created||0)}</td><td>{Number(x.delivered||0)}</td><td>{Number(x.pending||0)}</td><td>{Number(x.bounced||0)}</td><td>{Number(x.failed||0)}</td></tr>):<tr><td colSpan={6} className="p-8 text-center text-[var(--muted)]">No delivery data.</td></tr>}</tbody></table></div></article>
        <article className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Top clicked links</h2></div><div className="divide-y divide-[var(--border)]">{links.length?links.map(x=><div key={String(x.url)} className="flex items-start justify-between gap-4 p-4"><a href={String(x.url)} target="_blank" rel="noreferrer" className="min-w-0 break-all text-sm font-bold text-violet-600 hover:underline">{String(x.url)}</a><div className="shrink-0 text-right text-xs"><b>{Number(x.unique_clickers||0)} people</b><div className="text-[var(--muted)]">{Number(x.clicks||0)} clicks</div></div></div>):<div className="p-8 text-center text-sm text-[var(--muted)]">No verified clicks.</div>}</div></article>
      </section>

      <section className="premium-panel mt-5 overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Recipient activity</h2><p className="mt-1 text-xs text-[var(--muted)]">Latest 30 messages in the selected period.</p></div>{recent.length?<div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[11px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3.5">Recipient</th><th>Status</th><th>Queued</th><th>Delivered</th><th>Detail</th></tr></thead><tbody>{recent.map(m=><tr key={String(m.id)} className="border-t border-[var(--border)]"><td className="px-5 py-4"><Link href={`/messages/${String(m.id)}`} className="font-bold hover:underline">{String(m.recipient_email)}</Link></td><td><MessageStatusBadge status={String(m.status)} compact/></td><td className="text-xs text-[var(--muted)]">{fmt(m.queued_at)}</td><td className="text-xs text-[var(--muted)]">{fmt(m.delivered_at)}</td><td className="max-w-[300px] truncate text-xs text-[var(--muted)]">{String(m.last_error||"—")}</td></tr>)}</tbody></table></div>:<div className="p-10 text-center text-sm text-[var(--muted)]">No recipient activity in this period.</div>}</section>
    </>}
  </AppShell>;
}
