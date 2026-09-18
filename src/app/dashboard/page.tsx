import { ArrowRight, ArrowUpRight, CircleGauge, FileUp, Globe2, MailCheck, Network, Plus, Send, ServerCog, ShieldCheck, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { desc, sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { db, databaseConfigured } from "@/db";
import { contacts, messages } from "@/db/schema";
import { workerHeartbeats } from "@/db/operations-schema";
import { getSession } from "@/lib/auth";
import { isRedisConfigured } from "@/lib/redis";

export default async function DashboardPage() {
  const session=await getSession(); if(!session) redirect("/login");
  let totalContacts=0,sentToday=0,delivered=0,queued=0,dbHealthy=false; let beats:typeof workerHeartbeats.$inferSelect[]=[];
  if(databaseConfigured){
    try{
      const [contactsRows,sentRows,deliveredRows,queuedRows]=await Promise.all([
        db.select({value:sql<number>`count(*)::int`}).from(contacts),
        db.select({value:sql<number>`count(*)::int`}).from(messages).where(sql`${messages.queuedAt} >= date_trunc('day', now())`),
        db.select({value:sql<number>`count(*)::int`}).from(messages).where(sql`${messages.status}='delivered'`),
        db.select({value:sql<number>`count(*)::int`}).from(messages).where(sql`${messages.status} in ('queued','ready_for_transport','sending','deferred')`),
      ]);
      totalContacts=contactsRows[0]?.value??0;sentToday=sentRows[0]?.value??0;delivered=deliveredRows[0]?.value??0;queued=queuedRows[0]?.value??0;dbHealthy=true;
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
  const redisReady=isRedisConfigured(); const beat=new Map(beats.map(x=>[x.workerName,x]));
  const workerOnline=(name:string)=>{const row=beat.get(name);return Boolean(row&&Date.now()-row.lastSeenAt.getTime()<12*60*1000)};
  const campaignOnline=workerOnline("campaign")&&workerOnline("policy"); const transportOnline=workerOnline("transport")&&workerOnline("event");
  const metrics=[{label:"Contacts",value:totalContacts.toLocaleString(),note:dbHealthy?"Persisted recipients":"Storage unavailable",icon:UsersRound,tint:"emerald"},{label:"Messages today",value:sentToday.toLocaleString(),note:"Entered the send pipeline",icon:Send,tint:"violet"},{label:"Delivered",value:delivered.toLocaleString(),note:"Confirmed remote delivery",icon:MailCheck,tint:"blue"},{label:"Active queue",value:queued.toLocaleString(),note:"Queued, sending or deferred",icon:CircleGauge,tint:"amber"}];
  const tint:Record<string,string>={emerald:"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",violet:"bg-violet-500/10 text-violet-700 dark:text-violet-300",blue:"bg-blue-500/10 text-blue-700 dark:text-blue-300",amber:"bg-amber-500/10 text-amber-700 dark:text-amber-300"};
  const system=[{label:"Application",state:"Online",good:true},{label:"PostgreSQL",state:dbHealthy?"Online":databaseConfigured?"Unavailable":"Not configured",good:dbHealthy},{label:"Redis",state:redisReady?"Configured":"Not configured",good:redisReady},{label:"Campaign workers",state:campaignOnline?"Online":"Offline",good:campaignOnline},{label:"Mail transport",state:transportOnline?"Online":"Offline",good:transportOnline}];
  return <AppShell session={session}>
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><div className="mb-2.5 flex flex-wrap items-center gap-2"><p className="page-eyebrow">Overview</p><span className="status-pill"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500"/> Control plane online</span></div><h1 className="page-title">Dashboard</h1><p className="page-description">Audience, message flow, delivery state and runtime health from one operational view.</p></div><div className="flex flex-wrap gap-2"><a href="/imports" className="btn-secondary"><FileUp className="h-4 w-4"/> Import contacts</a><a href="/campaigns" className="btn-primary"><Plus className="h-4 w-4"/> New campaign</a></div></div>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(metric=>{const Icon=metric.icon;return <article key={metric.label} className="metric-card p-4"><div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-extrabold text-[var(--muted)]">{metric.label}</p><p className="mt-2.5 text-[30px] font-black leading-none tracking-[-0.045em]">{metric.value}</p></div><div className={`grid h-9 w-9 place-items-center rounded-xl ${tint[metric.tint]}`}><Icon className="h-[18px] w-[18px]" strokeWidth={1.9}/></div></div><p className="mt-4 border-t border-[var(--border)] pt-3 text-[10.5px] font-semibold leading-4 text-[var(--muted)]">{metric.note}</p></article>})}</section>
    <section className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_.85fr]">
      <article className="premium-panel overflow-hidden"><div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4"><div><p className="text-[9px] font-black uppercase tracking-[0.17em] text-[var(--muted)]">Sending flow</p><h2 className="mt-1 text-lg font-black tracking-[-0.02em]">Mail pipeline</h2></div><a href="/infrastructure" className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-violet-700 dark:text-violet-300">Infrastructure <ArrowUpRight className="h-3.5 w-3.5"/></a></div><div className="grid gap-2.5 p-5 sm:grid-cols-2 xl:grid-cols-4">{[[UsersRound,"Audience","Contacts & segments","/contacts"],[Send,"Campaign engine","Scheduling & workers","/campaigns"],[Network,"Transport","Accounts & mail routing","/infrastructure"],[MailCheck,"Delivery events","Bounce & engagement","/reports"]].map(([Icon,label,note,href],index)=>{const Component=Icon as typeof UsersRound;return <a key={String(label)} href={String(href)} className="group panel-soft p-3.5 transition hover:border-violet-500/25 hover:bg-violet-500/[0.035]"><div className="flex items-start justify-between gap-3"><div className="grid h-8 w-8 place-items-center rounded-[10px] bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Component className="h-4 w-4"/></div><span className="text-[9px] font-black text-[var(--muted)]">0{index+1}</span></div><p className="mt-3 text-[12px] font-extrabold">{String(label)}</p><p className="mt-1 text-[10.5px] leading-4 text-[var(--muted)]">{String(note)}</p><ArrowRight className="mt-3 h-3.5 w-3.5 text-[var(--muted)] transition group-hover:translate-x-1 group-hover:text-violet-600"/></a>})}</div></article>
      <article className="premium-panel p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-[9px] font-black uppercase tracking-[0.17em] text-[var(--muted)]">Runtime</p><h2 className="mt-1 text-lg font-black tracking-[-0.02em]">System readiness</h2></div><div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"><ShieldCheck className="h-[18px] w-[18px]"/></div></div><div className="mt-5 space-y-2">{system.map(item=><div key={item.label} className="flex items-center justify-between gap-4 rounded-[11px] border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5"><span className="flex min-w-0 items-center gap-2 text-[11.5px] font-bold"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.good?"bg-emerald-500":"bg-amber-500"}`}/><span className="truncate">{item.label}</span></span><span className="shrink-0 text-[8.5px] font-black uppercase tracking-[0.08em] text-[var(--muted)]">{item.state}</span></div>)}</div><div className="mt-4 grid grid-cols-2 gap-2"><a href="/system-health" className="panel-soft flex items-center gap-2 p-2.5 text-[10.5px] font-extrabold transition hover:border-violet-500/20"><ServerCog className="h-3.5 w-3.5 text-violet-600"/> Health</a><a href="/domains" className="panel-soft flex items-center gap-2 p-2.5 text-[10.5px] font-extrabold transition hover:border-violet-500/20"><Globe2 className="h-3.5 w-3.5 text-violet-600"/> Domains</a></div></article>
    </section>
  </AppShell>;
}
