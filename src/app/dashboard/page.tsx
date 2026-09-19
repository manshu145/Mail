import { ArrowUpRight, CircleGauge, Eye, FileUp, Globe2, Mail, MailCheck, MousePointerClick, Plus, Send, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { db, databaseConfigured } from "@/db";
import { contacts, messages } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function DashboardPage() {
  const session=await getSession(); if(!session) redirect("/login");
  let totalContacts=0,sentToday=0,delivered=0,inProgress=0,dataReady=false;
  let recentCampaigns:Array<Record<string,unknown>>=[];
  let activeSubscribers:Array<Record<string,unknown>>=[];
  let aggregate:{targeted:number;delivered:number;bounced:number;opens:number;clicks:number}={targeted:0,delivered:0,bounced:0,opens:0,clicks:0};

  if(databaseConfigured){
    try{
      const [contactsRows,sentRows,deliveredRows,progressRows]=await Promise.all([
        db.select({value:sql<number>`count(*)::int`}).from(contacts),
        db.select({value:sql<number>`count(*)::int`}).from(messages).where(sql`${messages.queuedAt} >= date_trunc('day', now())`),
        db.select({value:sql<number>`count(*)::int`}).from(messages).where(sql`${messages.status}='delivered'`),
        db.select({value:sql<number>`count(*)::int`}).from(messages).where(sql`${messages.status} in ('queued','ready_for_transport','sending','mta_accepted','deferred')`),
      ]);
      totalContacts=contactsRows[0]?.value??0;
      sentToday=sentRows[0]?.value??0;
      delivered=deliveredRows[0]?.value??0;
      inProgress=progressRows[0]?.value??0;
      dataReady=true;

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
      console.error("Dashboard data query failed",error);
      dataReady=false;
    }
  }

  const metrics=[
    {label:"Contacts",value:dataReady?totalContacts.toLocaleString():"—",note:"Saved recipients",icon:UsersRound,tint:"emerald"},
    {label:"Messages today",value:dataReady?sentToday.toLocaleString():"—",note:"Today's campaign messages",icon:Send,tint:"violet"},
    {label:"Delivered",value:dataReady?delivered.toLocaleString():"—",note:"Confirmed deliveries",icon:MailCheck,tint:"blue"},
    {label:"In progress",value:dataReady?inProgress.toLocaleString():"—",note:"Waiting or being delivered",icon:CircleGauge,tint:"amber"},
  ];
  const tint:Record<string,string>={emerald:"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",violet:"bg-violet-500/10 text-violet-700 dark:text-violet-300",blue:"bg-blue-500/10 text-blue-700 dark:text-blue-300",amber:"bg-amber-500/10 text-amber-700 dark:text-amber-300"};
  const pct=(num:number,den:number)=>den>0?Math.round((num/den)*10000)/100:0;
  const rateStats=[
    {label:"Delivery progress",value:pct(aggregate.delivered,aggregate.targeted),icon:MailCheck},
    {label:"Open rate",value:pct(aggregate.opens,aggregate.delivered),icon:Eye},
    {label:"Click rate",value:pct(aggregate.clicks,aggregate.delivered),icon:MousePointerClick},
    {label:"Bounce rate",value:pct(aggregate.bounced,aggregate.delivered+aggregate.bounced),icon:CircleGauge},
  ];

  return <AppShell session={session}>
    <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="page-eyebrow mb-2">Overview</p><h1 className="page-title">Dashboard</h1><p className="page-description">Campaign performance, audience activity and delivery results at a glance.</p></div>
      <div className="flex flex-wrap items-center gap-2"><a href="/imports" className="btn-secondary"><FileUp className="h-4 w-4"/> Import contacts</a><a href="/campaigns" className="btn-primary"><Plus className="h-4 w-4"/> New campaign</a></div>
    </div>

    {!dataReady?<div className="mb-4 rounded-2xl border border-amber-500/15 bg-amber-500/[0.055] px-4 py-3 text-sm text-amber-800 dark:text-amber-200">Workspace data is temporarily unavailable. Please refresh shortly.</div>:null}

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(metric=>{const Icon=metric.icon;return <article key={metric.label} className="metric-card group p-5 xl:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-[12px] font-extrabold text-[var(--muted)]">{metric.label}</p><p className="mt-3 text-[36px] font-black leading-none tracking-[-0.05em]">{metric.value}</p></div><div className={`grid h-11 w-11 place-items-center rounded-[14px] transition duration-200 group-hover:scale-105 ${tint[metric.tint]}`}><Icon className="h-5 w-5" strokeWidth={1.9}/></div></div><p className="mt-5 border-t border-[var(--border)] pt-4 text-[12px] font-semibold leading-5 text-[var(--muted)]">{metric.note}</p></article>})}</section>

    <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {rateStats.map(({label,value,icon:Icon})=><article key={label} className="flex items-center justify-between gap-4 rounded-[14px] border border-[var(--border)] bg-[var(--surface-soft)] px-4 py-4"><div><p className="text-[11px] font-bold text-[var(--muted)]">{label}</p><p className="mt-1 text-[21px] font-black tracking-[-0.025em]">{dataReady?value.toFixed(2)+"%":"—"}</p></div><Icon className="h-4 w-4 text-violet-600"/></article>)}
    </section>

    <section className="mt-5 grid gap-5 xl:grid-cols-2">
      <article className="premium-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4.5"><div><p className="page-eyebrow">Activity</p><h2 className="mt-1 text-[17px] font-black tracking-[-0.02em]">Recent campaigns</h2></div><a href="/campaigns" className="inline-flex items-center gap-1.5 text-[12px] font-extrabold text-violet-700 dark:text-violet-300">View all <ArrowUpRight className="h-3 w-3"/></a></div>
        {recentCampaigns.length?<div className="divide-y divide-[var(--border)]">{recentCampaigns.map((row)=><a key={String(row.id)} href={`/campaigns/${String(row.id)}`} className="flex items-center justify-between gap-5 px-5 py-4 transition hover:bg-[var(--surface-soft)]"><div className="min-w-0"><p className="truncate text-[13px] font-extrabold">{String(row.name)}</p><p className="mt-1 text-[11px] text-[var(--muted)]">{new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(new Date(String(row.created_at)))}</p></div><div className="flex shrink-0 items-center gap-4 text-right"><div><p className="text-[11px] font-bold text-[var(--muted)]">Delivered</p><p className="text-[13px] font-black">{Number(row.delivered||0).toLocaleString()} / {Number(row.targeted||0).toLocaleString()}</p></div><span className="rounded-full bg-violet-500/10 px-2.5 py-1.5 text-[10px] font-black capitalize text-violet-700 dark:text-violet-300">{String(row.status)}</span></div></a>)}</div>:<div className="p-8 text-center text-sm text-[var(--muted)]">No campaigns yet.</div>}
      </article>

      <article className="premium-panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4.5"><div><p className="page-eyebrow">Engagement</p><h2 className="mt-1 text-[17px] font-black tracking-[-0.02em]">Most active subscribers</h2></div><a href="/contacts" className="inline-flex items-center gap-1.5 text-[12px] font-extrabold text-violet-700 dark:text-violet-300">Contacts <ArrowUpRight className="h-3 w-3"/></a></div>
        {activeSubscribers.length?<div className="divide-y divide-[var(--border)]">{activeSubscribers.map((row)=><a key={String(row.id)} href={`/contacts/${String(row.id)}`} className="flex items-center justify-between gap-5 px-5 py-4 transition hover:bg-[var(--surface-soft)]"><div className="min-w-0"><p className="truncate text-[13px] font-extrabold">{String(row.name)}</p><p className="mt-1 truncate text-[11px] text-[var(--muted)]">{String(row.email)}</p></div><div className="flex shrink-0 gap-4 text-right"><div><p className="text-[10px] font-bold text-[var(--muted)]">Opens</p><p className="text-[13px] font-black">{Number(row.opens||0).toLocaleString()}</p></div><div><p className="text-[10px] font-bold text-[var(--muted)]">Clicks</p><p className="text-[13px] font-black">{Number(row.clicks||0).toLocaleString()}</p></div></div></a>)}</div>:<div className="p-8 text-center text-sm text-[var(--muted)]">No engagement activity yet.</div>}
      </article>
    </section>

    <section className="premium-panel mt-5 p-5 xl:p-6">
      <div className="mb-4"><p className="page-eyebrow">Quick access</p><h2 className="mt-1 text-[17px] font-black tracking-[-0.02em]">Manage your workspace</h2></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[[UsersRound,"Contacts","Manage audience","/contacts"],[Mail,"Templates","Create email content","/templates"],[Globe2,"Sending domains","Manage verified domains","/domains"],[MailCheck,"Reports","View campaign results","/reports"]].map(([Icon,label,note,href])=>{const Component=Icon as typeof UsersRound;return <a key={String(label)} href={String(href)} className="panel-soft flex items-center gap-3.5 p-4 transition hover:border-violet-500/30 hover:bg-violet-500/[0.04]"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Component className="h-[18px] w-[18px]"/></div><div className="min-w-0"><p className="text-[12px] font-extrabold">{String(label)}</p><p className="mt-0.5 text-[11px] text-[var(--muted)]">{String(note)}</p></div></a>})}
      </div>
    </section>
  </AppShell>;
}
