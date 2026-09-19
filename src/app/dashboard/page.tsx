import { ArrowUpRight, CircleGauge, Eye, FileUp, Globe2, Mail, MailCheck, MousePointerClick, Plus, Send, Sparkles, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { db, databaseConfigured } from "@/db";
import { contacts, messages } from "@/db/schema";
import { getSession } from "@/lib/auth";

const fmt=(value:unknown)=>new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(new Date(String(value)));

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
      totalContacts=contactsRows[0]?.value??0; sentToday=sentRows[0]?.value??0; delivered=deliveredRows[0]?.value??0; inProgress=progressRows[0]?.value??0; dataReady=true;

      const [aggregateResult,recentResult,activeResult]=await Promise.all([
        db.execute(sql`
          with message_totals as (
            select count(*)::int targeted,
              count(*) filter(where status='delivered')::int delivered,
              count(*) filter(where status='bounced')::int bounced
            from messages
          ), engagement as (
            select count(distinct message_id) filter(where type='open' and coalesce((payload->>'automated')::boolean,false)=false)::int opens,
              count(distinct message_id) filter(where type='click' and coalesce((payload->>'automated')::boolean,false)=false)::int clicks
            from message_events
          )
          select message_totals.*,engagement.opens,engagement.clicks from message_totals cross join engagement
        `),
        db.execute(sql`
          select c.id::text,c.name,c.status::text,c.created_at,
            count(m.id)::int targeted,
            count(m.id) filter(where m.status='delivered')::int delivered
          from campaigns c left join messages m on m.campaign_id=c.id
          group by c.id,c.name,c.status,c.created_at order by c.created_at desc limit 6
        `),
        db.execute(sql`
          select ct.id::text,ct.email,
            coalesce(nullif(trim(concat_ws(' ',ct.first_name,ct.last_name)),''),ct.email) name,
            count(*) filter(where e.type='open' and coalesce((e.payload->>'automated')::boolean,false)=false)::int opens,
            count(*) filter(where e.type='click' and coalesce((e.payload->>'automated')::boolean,false)=false)::int clicks,
            max(e.created_at) filter(where e.type in ('open','click') and coalesce((e.payload->>'automated')::boolean,false)=false) last_activity
          from contacts ct join messages m on m.contact_id=ct.id join message_events e on e.message_id=m.id
          where e.type in ('open','click') and coalesce((e.payload->>'automated')::boolean,false)=false
          group by ct.id,ct.email,ct.first_name,ct.last_name
          order by (count(*) filter(where e.type='open' and coalesce((e.payload->>'automated')::boolean,false)=false)
                  + count(*) filter(where e.type='click' and coalesce((e.payload->>'automated')::boolean,false)=false) * 2) desc,
                   last_activity desc nulls last limit 6
        `)
      ]);
      const a=aggregateResult.rows[0] as Record<string,unknown>|undefined;
      aggregate={targeted:Number(a?.targeted||0),delivered:Number(a?.delivered||0),bounced:Number(a?.bounced||0),opens:Number(a?.opens||0),clicks:Number(a?.clicks||0)};
      recentCampaigns=recentResult.rows as Array<Record<string,unknown>>;
      activeSubscribers=activeResult.rows as Array<Record<string,unknown>>;
    }catch(error){ console.error("Dashboard data query failed",error); dataReady=false; }
  }

  const metrics=[
    {label:"Contacts",value:dataReady?totalContacts.toLocaleString():"—",note:"Saved recipients",icon:UsersRound,tint:"emerald"},
    {label:"Messages today",value:dataReady?sentToday.toLocaleString():"—",note:"Created since midnight",icon:Send,tint:"violet"},
    {label:"Delivered",value:dataReady?delivered.toLocaleString():"—",note:"Confirmed remote deliveries",icon:MailCheck,tint:"blue"},
    {label:"In progress",value:dataReady?inProgress.toLocaleString():"—",note:"Queued, accepted or retrying",icon:CircleGauge,tint:"amber"},
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
    <div className="page-intro">
      <div>
        <div className="mb-2 flex items-center gap-2"><p className="page-eyebrow">Overview</p><span className="status-pill !py-1"><span className="live-dot"/>Live workspace</span></div>
        <h1 className="page-title">Dashboard</h1>
        <p className="page-description">Campaign performance, audience activity and delivery results at a glance.</p>
      </div>
      <div className="page-actions"><a href="/imports" className="btn-secondary"><FileUp className="h-4 w-4"/>Import contacts</a><a href="/campaigns" className="btn-primary"><Plus className="h-4 w-4"/>New campaign</a></div>
    </div>

    {!dataReady?<div className="mb-4 rounded-2xl border border-amber-500/15 bg-amber-500/[0.055] px-4 py-3 text-sm text-amber-800 dark:text-amber-200">Workspace data is temporarily unavailable. Please refresh shortly.</div>:null}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric,index)=>{const Icon=metric.icon;return <article key={metric.label} className={`metric-card surface-lift group p-5 xl:p-6 reveal reveal-delay-${Math.min(index+1,4)}`}><div className="flex items-start justify-between gap-4"><div className="metric-accent pl-3"><p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-[var(--muted)]">{metric.label}</p><p className="metric-value mt-3 text-[34px] font-black leading-none">{metric.value}</p></div><div className={`grid h-11 w-11 place-items-center rounded-[14px] transition duration-200 group-hover:scale-105 ${tint[metric.tint]}`}><Icon className="h-5 w-5" strokeWidth={1.9}/></div></div><p className="mt-5 border-t border-[var(--border)] pt-3 text-[11px] font-semibold leading-5 text-[var(--muted)]">{metric.note}</p></article>})}
    </section>

    <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {rateStats.map(({label,value,icon:Icon})=><article key={label} className="section-card surface-lift p-4"><div className="flex items-center justify-between gap-4"><div><p className="text-[11px] font-bold text-[var(--muted)]">{label}</p><p className="metric-value mt-1 text-[22px] font-black">{dataReady?value.toFixed(2)+"%":"—"}</p></div><div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/[.08] text-violet-600 dark:text-violet-300"><Icon className="h-4 w-4"/></div></div><div className="progress-track mt-3"><div className="progress-fill" style={{width:`${Math.min(100,Math.max(0,value))}%`}}/></div></article>)}
    </section>

    <section className="mt-5 grid gap-5 xl:grid-cols-2">
      <article className="section-card">
        <div className="section-card-header"><div><p className="page-eyebrow">Activity</p><h2 className="section-card-title mt-1">Recent campaigns</h2><p className="section-card-copy">Latest launches and their live delivery progress.</p></div><a href="/campaigns" className="inline-flex items-center gap-1.5 text-[12px] font-extrabold text-violet-700 dark:text-violet-300">View all <ArrowUpRight className="h-3 w-3"/></a></div>
        {recentCampaigns.length?<div className="divide-y divide-[var(--border)]">{recentCampaigns.map((row)=>{const targeted=Number(row.targeted||0),deliveredCount=Number(row.delivered||0),progress=pct(deliveredCount,targeted);return <a key={String(row.id)} href={`/campaigns/${String(row.id)}`} className="interactive-row block px-4 py-4 sm:px-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-[13px] font-extrabold">{String(row.name)}</p><span className="rounded-full bg-violet-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-300">{String(row.status)}</span></div><p className="mt-1 text-[11px] text-[var(--muted)]">{fmt(row.created_at)}</p></div><div className="sm:min-w-44"><div className="flex items-center justify-between text-[10px]"><span className="font-bold text-[var(--muted)]">Delivered</span><b>{deliveredCount.toLocaleString()} / {targeted.toLocaleString()}</b></div><div className="progress-track mt-2"><div className="progress-fill" style={{width:`${Math.min(100,progress)}%`}}/></div></div></div></div></a>})}</div>:<div className="p-8 text-center text-sm text-[var(--muted)]">No campaigns yet.</div>}
      </article>

      <article className="section-card">
        <div className="section-card-header"><div><p className="page-eyebrow">Engagement</p><h2 className="section-card-title mt-1">Most active subscribers</h2><p className="section-card-copy">People generating the strongest verified engagement.</p></div><a href="/contacts" className="inline-flex items-center gap-1.5 text-[12px] font-extrabold text-violet-700 dark:text-violet-300">Contacts <ArrowUpRight className="h-3 w-3"/></a></div>
        {activeSubscribers.length?<div className="divide-y divide-[var(--border)]">{activeSubscribers.map((row)=><a key={String(row.id)} href={`/contacts/${String(row.id)}`} className="interactive-row flex items-center justify-between gap-4 px-4 py-4 sm:px-5"><div className="flex min-w-0 items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[linear-gradient(145deg,var(--accent-soft),var(--accent-soft-2))] text-xs font-black text-[var(--accent)]">{String(row.name||row.email).slice(0,1).toUpperCase()}</div><div className="min-w-0"><p className="truncate text-[13px] font-extrabold">{String(row.name)}</p><p className="mt-1 truncate text-[11px] text-[var(--muted)]">{String(row.email)}</p></div></div><div className="flex shrink-0 gap-4 text-right"><div><p className="text-[9px] font-bold uppercase tracking-wide text-[var(--muted)]">Opens</p><p className="text-[13px] font-black">{Number(row.opens||0).toLocaleString()}</p></div><div><p className="text-[9px] font-bold uppercase tracking-wide text-[var(--muted)]">Clicks</p><p className="text-[13px] font-black">{Number(row.clicks||0).toLocaleString()}</p></div></div></a>)}</div>:<div className="p-8 text-center text-sm text-[var(--muted)]">No engagement activity yet.</div>}
      </article>
    </section>

    <section className="premium-panel mt-5 p-5 xl:p-6">
      <div className="mb-4 flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><Sparkles className="h-5 w-5"/></div><div><p className="page-eyebrow">Quick access</p><h2 className="mt-1 text-[17px] font-black tracking-[-0.02em]">Manage your workspace</h2><p className="mt-1 text-xs text-[var(--muted)]">Jump into the tasks you use most.</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[[UsersRound,"Contacts","Manage audience","/contacts"],[Mail,"Templates","Create email content","/templates"],[Globe2,"Sending domains","Manage verified domains","/domains"],[MailCheck,"Reports","Explore campaign results","/reports"]].map(([Icon,label,note,href])=>{const Component=Icon as typeof UsersRound;return <a key={String(label)} href={String(href)} className="panel-soft surface-lift flex items-center gap-3.5 p-4"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Component className="h-[18px] w-[18px]"/></div><div className="min-w-0"><p className="text-[12px] font-extrabold">{String(label)}</p><p className="mt-0.5 text-[11px] text-[var(--muted)]">{String(note)}</p></div><ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--muted)]"/></a>})}
      </div>
    </section>
  </AppShell>;
}
