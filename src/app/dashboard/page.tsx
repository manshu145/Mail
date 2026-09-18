import { ArrowRight, ArrowUpRight, CircleGauge, Eye, FileUp, Globe2, MailCheck, MousePointerClick, Network, Plus, Send, ServerCog, ShieldCheck, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { desc, sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { LiveRefresh } from "@/components/live-refresh";
import { db, databaseConfigured } from "@/db";
import { contacts, messages } from "@/db/schema";
import { workerHeartbeats } from "@/db/operations-schema";
import { getSession } from "@/lib/auth";
import { getRedis, isRedisConfigured } from "@/lib/redis";
import { isWorkerHeartbeatFresh } from "@/lib/worker-health";

export default async function DashboardPage() {
  const session=await getSession(); if(!session) redirect("/login");
  let totalContacts=0,sentToday=0,delivered=0,queued=0,dbHealthy=false; let beats:typeof workerHeartbeats.$inferSelect[]=[]; let recentCampaigns:Array<Record<string,unknown>>=[]; let activeSubscribers:Array<Record<string,unknown>>=[]; let aggregate:{targeted:number;delivered:number;bounced:number;opens:number;clicks:number}={targeted:0,delivered:0,bounced:0,opens:0,clicks:0};
  if(databaseConfigured){
    try{
      const [contactsRows,sentRows,deliveredRows,queuedRows]=await Promise.all([
        db.select({value:sql<number>`count(*)::int`}).from(contacts),
        db.select({value:sql<number>`count(*)::int`}).from(messages).where(sql`${messages.queuedAt} >= date_trunc('day', now())`),
        db.select({value:sql<number>`count(*)::int`}).from(messages).where(sql`${messages.status}='delivered'`),
        db.select({value:sql<number>`count(*)::int`}).from(messages).where(sql`${messages.status} in ('queued','ready_for_transport','sending','deferred')`),
      ]);
      totalContacts=contactsRows[0]?.value??0;sentToday=sentRows[0]?.value??0;delivered=deliveredRows[0]?.value??0;queued=queuedRows[0]?.value??0;dbHealthy=true;
      const [aggregateResult,recentResult,activeResult]=await Promise.all([
        db.execute(sql`
          with message_totals as (
            select
              count(*)::int targeted,
              count(*) filter(where status='delivered')::int delivered,
              count(*) filter(where status='bounced')::int bounced
            from messages
          ), engagement as (
            select
              count(distinct message_id) filter(where type='open' and coalesce((payload->>'automated')::boolean,false)=false)::int opens,
              count(distinct message_id) filter(where type='click' and coalesce((payload->>'automated')::boolean,false)=false)::int clicks
            from message_events
          )
          select message_totals.*,engagement.opens,engagement.clicks
          from message_totals cross join engagement
        `),
        db.execute(sql`
          select c.id::text,c.name,c.status::text,c.created_at,
            count(m.id)::int targeted,
            count(m.id) filter(where m.status='delivered')::int delivered
          from campaigns c
          left join messages m on m.campaign_id=c.id
          group by c.id,c.name,c.status,c.created_at
          order by c.created_at desc
          limit 6
        `),
        db.execute(sql`
          select ct.id::text,ct.email,
            coalesce(nullif(trim(concat_ws(' ',ct.first_name,ct.last_name)),''),ct.email) name,
            count(*) filter(where e.type='open' and coalesce((e.payload->>'automated')::boolean,false)=false)::int opens,
            count(*) filter(where e.type='click' and coalesce((e.payload->>'automated')::boolean,false)=false)::int clicks,
            max(e.created_at) filter(where e.type in ('open','click') and coalesce((e.payload->>'automated')::boolean,false)=false) last_activity
          from contacts ct
          join messages m on m.contact_id=ct.id
          join message_events e on e.message_id=m.id
          where e.type in ('open','click') and coalesce((e.payload->>'automated')::boolean,false)=false
          group by ct.id,ct.email,ct.first_name,ct.last_name
          order by (count(*) filter(where e.type='open' and coalesce((e.payload->>'automated')::boolean,false)=false)
                  + count(*) filter(where e.type='click' and coalesce((e.payload->>'automated')::boolean,false)=false) * 2) desc,
                   last_activity desc nulls last
          limit 6
        `)
      ]);
      const a=aggregateResult.rows[0] as Record<string,unknown>|undefined;
      aggregate={targeted:Number(a?.targeted||0),delivered:Number(a?.delivered||0),bounced:Number(a?.bounced||0),opens:Number(a?.opens||0),clicks:Number(a?.clicks||0)};
      recentCampaigns=recentResult.rows as Array<Record<string,unknown>>;
      activeSubscribers=activeResult.rows as Array<Record<string,unknown>>;
    }catch(error){
      console.error("Dashboard core database query failed",error);
      dbHealthy=false;
    }
    try{
      beats=await db.select().from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastSeenAt));
    }catch(error){
      console.error("Dashboard worker heartbeat query failed",error);
      beats=[];
    }
  }
  let redisHealthy=false;
  if(isRedisConfigured()){
    try{
      const client=getRedis();
      if(client.status==="wait")await client.connect();
      redisHealthy=(await client.ping())==="PONG";
    }catch(error){
      console.error("Dashboard Redis health check failed",error);
      redisHealthy=false;
    }
  }
  const beat=new Map(beats.map(x=>[x.workerName,x]));
  const workerOnline=(name:string)=>{const row=beat.get(name);return Boolean(row&&isWorkerHeartbeatFresh(row.lastSeenAt))};
  const campaignOnline=workerOnline("campaign")&&workerOnline("policy");
  const transportOnline=workerOnline("transport")&&workerOnline("event")&&workerOnline("postfix-events")&&workerOnline("bounce-receiver");
  const controlPlaneHealthy=dbHealthy&&redisHealthy&&campaignOnline&&transportOnline;
  const metrics=[{label:"Contacts",value:dbHealthy?totalContacts.toLocaleString():"—",note:dbHealthy?"Persisted recipients":"Storage unavailable",icon:UsersRound,tint:"emerald"},{label:"Messages today",value:dbHealthy?sentToday.toLocaleString():"—",note:dbHealthy?"Entered the send pipeline":"Storage unavailable",icon:Send,tint:"violet"},{label:"Delivered",value:dbHealthy?delivered.toLocaleString():"—",note:dbHealthy?"Confirmed remote delivery":"Storage unavailable",icon:MailCheck,tint:"blue"},{label:"Active queue",value:dbHealthy?queued.toLocaleString():"—",note:dbHealthy?"Queued, sending or deferred":"Storage unavailable",icon:CircleGauge,tint:"amber"}];
  const tint:Record<string,string>={emerald:"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",violet:"bg-violet-500/10 text-violet-700 dark:text-violet-300",blue:"bg-blue-500/10 text-blue-700 dark:text-blue-300",amber:"bg-amber-500/10 text-amber-700 dark:text-amber-300"};
  const system=[{label:"Application",state:"Online",good:true},{label:"PostgreSQL",state:dbHealthy?"Online":databaseConfigured?"Unavailable":"Not configured",good:dbHealthy},{label:"Redis",state:redisHealthy?"Online":isRedisConfigured()?"Unavailable":"Not configured",good:redisHealthy},{label:"Campaign workers",state:campaignOnline?"Online":"Offline",good:campaignOnline},{label:"Mail pipeline",state:transportOnline?"Online":"Offline",good:transportOnline}];
  const pct=(num:number,den:number)=>den>0?Math.round((num/den)*10000)/100:0;
  const deliveryProgress=pct(aggregate.delivered,aggregate.targeted);
  const openRate=pct(aggregate.opens,aggregate.delivered);
  const clickRate=pct(aggregate.clicks,aggregate.delivered);
  const bounceRate=pct(aggregate.bounced,aggregate.delivered+aggregate.bounced);
  const rateStats=[
    {label:"Delivery progress",value:deliveryProgress,icon:MailCheck},
    {label:"Open rate",value:openRate,icon:Eye},
    {label:"Click rate",value:clickRate,icon:MousePointerClick},
    {label:"Bounce rate",value:bounceRate,icon:CircleGauge},
  ];
  return <AppShell session={session}>
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="mb-2.5 flex flex-wrap items-center gap-2"><p className="page-eyebrow">Overview</p><span className="status-pill"><span className={`h-1.5 w-1.5 rounded-full ${controlPlaneHealthy?"bg-emerald-500":"bg-amber-500"}`}/> {controlPlaneHealthy?"Control plane healthy":"Control plane degraded"}</span></div><h1 className="page-title">Dashboard</h1><p className="page-description">Audience, message flow, delivery state and runtime health from one operational view.</p></div><div className="flex flex-wrap items-center gap-2"><LiveRefresh intervalMs={10000} label="Live"/><a href="/imports" className="btn-secondary"><FileUp className="h-4 w-4"/> Import contacts</a><a href="/campaigns" className="btn-primary"><Plus className="h-4 w-4"/> New campaign</a></div></div>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(metric=>{const Icon=metric.icon;return <article key={metric.label} className="metric-card group p-4"><div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-extrabold text-[var(--muted)]">{metric.label}</p><p className="mt-2.5 text-[30px] font-black leading-none tracking-[-0.045em]">{metric.value}</p></div><div className={`grid h-9 w-9 place-items-center rounded-xl transition duration-200 group-hover:scale-105 group-hover:shadow-[0_6px_18px_rgba(109,93,252,.12)] ${tint[metric.tint]}`}><Icon className="h-[18px] w-[18px]" strokeWidth={1.9}/></div></div><p className="mt-4 border-t border-[var(--border)] pt-3 text-[10.5px] font-semibold leading-4 text-[var(--muted)]">{metric.note}</p></article>})}</section>
    <section className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {rateStats.map(({label,value,icon:Icon})=><article key={label} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-3"><div><p className="text-[10px] font-bold text-[var(--muted)]">{label}</p><p className="mt-0.5 text-lg font-black">{dbHealthy?value.toFixed(2)+"%":"—"}</p></div><Icon className="h-4 w-4 text-violet-600"/></article>)}
    </section>

    <section className="mt-4 grid gap-4 xl:grid-cols-2">
      <article className="premium-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3.5"><div><p className="page-eyebrow">Activity</p><h2 className="mt-1 text-base font-black">Recent campaigns</h2></div><a href="/campaigns" className="inline-flex items-center gap-1 text-[10.5px] font-extrabold text-violet-700 dark:text-violet-300">View all <ArrowUpRight className="h-3 w-3"/></a></div>
        {recentCampaigns.length?<div className="divide-y divide-[var(--border)]">{recentCampaigns.map((row)=><a key={String(row.id)} href={`/campaigns/${String(row.id)}`} className="flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-[var(--surface-soft)]"><div className="min-w-0"><p className="truncate text-[12px] font-extrabold">{String(row.name)}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short", timeZone:"Asia/Kolkata"}).format(new Date(String(row.created_at)))}</p></div><div className="flex shrink-0 items-center gap-4 text-right"><div><p className="text-[10px] font-bold text-[var(--muted)]">Delivered</p><p className="text-[12px] font-black">{Number(row.delivered||0).toLocaleString()} / {Number(row.targeted||0).toLocaleString()}</p></div><span className="rounded-full bg-violet-500/10 px-2 py-1 text-[9px] font-black capitalize text-violet-700 dark:text-violet-300">{String(row.status)}</span></div></a>)}</div>:<div className="p-6 text-center text-xs text-[var(--muted)]">No campaigns yet.</div>}
      </article>

      <article className="premium-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3.5"><div><p className="page-eyebrow">Engagement</p><h2 className="mt-1 text-base font-black">Most active subscribers</h2></div><a href="/contacts" className="inline-flex items-center gap-1 text-[10.5px] font-extrabold text-violet-700 dark:text-violet-300">Contacts <ArrowUpRight className="h-3 w-3"/></a></div>
        {activeSubscribers.length?<div className="divide-y divide-[var(--border)]">{activeSubscribers.map((row)=><a key={String(row.id)} href={`/contacts/${String(row.id)}`} className="flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-[var(--surface-soft)]"><div className="min-w-0"><p className="truncate text-[12px] font-extrabold">{String(row.name)}</p><p className="truncate text-[10px] text-[var(--muted)]">{String(row.email)}</p></div><div className="flex shrink-0 gap-4 text-right"><div><p className="text-[9px] font-bold text-[var(--muted)]">Opens</p><p className="text-[12px] font-black">{Number(row.opens||0).toLocaleString()}</p></div><div><p className="text-[9px] font-bold text-[var(--muted)]">Clicks</p><p className="text-[12px] font-black">{Number(row.clicks||0).toLocaleString()}</p></div></div></a>)}</div>:<div className="p-6 text-center text-xs text-[var(--muted)]">No engagement activity yet.</div>}
      </article>
    </section>

    <section className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
      <article className="premium-panel overflow-hidden"><div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3.5"><div><p className="page-eyebrow">Sending flow</p><h2 className="mt-1 text-base font-black">Mail pipeline</h2></div><a href="/infrastructure" className="inline-flex items-center gap-1 text-[10.5px] font-extrabold text-violet-700 dark:text-violet-300">Infrastructure <ArrowUpRight className="h-3 w-3"/></a></div><div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-4">{[[UsersRound,"Audience","Contacts","/contacts"],[Send,"Campaigns","Scheduling","/campaigns"],[Network,"Transport","Routing","/infrastructure"],[MailCheck,"Reports","Delivery","/reports"]].map(([Icon,label,note,href])=>{const Component=Icon as typeof UsersRound;return <a key={String(label)} href={String(href)} className="panel-soft flex items-center gap-3 p-3 transition hover:border-violet-500/30 hover:bg-violet-500/[0.04]"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Component className="h-4 w-4"/></div><div className="min-w-0"><p className="text-[11px] font-extrabold">{String(label)}</p><p className="text-[9.5px] text-[var(--muted)]">{String(note)}</p></div><ArrowRight className="ml-auto h-3 w-3 text-[var(--muted)]"/></a>})}</div></article>

      <article className="premium-panel p-4"><div className="flex items-center justify-between gap-3"><div><p className="page-eyebrow">Runtime</p><h2 className="mt-1 text-base font-black">System readiness</h2></div><ShieldCheck className="h-5 w-5 text-emerald-600"/></div><div className="mt-3 space-y-1.5">{system.map(item=><div key={item.label} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-soft)] px-2.5 py-2"><span className="flex min-w-0 items-center gap-2 text-[10.5px] font-bold"><span className={`h-1.5 w-1.5 rounded-full ${item.good?"bg-emerald-500":"bg-amber-500"}`}/>{item.label}</span><span className="text-[8px] font-black uppercase text-[var(--muted)]">{item.state}</span></div>)}</div><div className="mt-3 flex gap-2"><a href="/system-health" className="btn-secondary !min-h-8 !px-3 !py-1.5 text-[10px]"><ServerCog className="h-3 w-3"/> Health</a><a href="/domains" className="btn-secondary !min-h-8 !px-3 !py-1.5 text-[10px]"><Globe2 className="h-3 w-3"/> Domains</a></div></article>
    </section>
  </AppShell>;
}
