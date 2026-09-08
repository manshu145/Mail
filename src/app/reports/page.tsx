import { BarChart3, MailCheck, MousePointerClick, ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { db, databaseConfigured } from "@/db";
import { messageEvents, messages } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function ReportsPage() {
  const session=await getSession(); if(!session) redirect("/login");
  let delivered=0,bounced=0,deferred=0,opens=0,clicks=0,total=0,dbError=false;
  if(databaseConfigured){try{const [t,d,b,df,o,c]=await Promise.all([
    db.select({value:sql<number>`count(*)::int`}).from(messages),
    db.select({value:sql<number>`count(*)::int`}).from(messages).where(sql`${messages.status}='delivered'`),
    db.select({value:sql<number>`count(*)::int`}).from(messages).where(sql`${messages.status}='bounced'`),
    db.select({value:sql<number>`count(*)::int`}).from(messages).where(sql`${messages.status}='deferred'`),
    db.select({value:sql<number>`count(*)::int`}).from(messageEvents).where(sql`${messageEvents.type}='open'`),
    db.select({value:sql<number>`count(*)::int`}).from(messageEvents).where(sql`${messageEvents.type}='click'`)
  ]);total=t[0]?.value??0;delivered=d[0]?.value??0;bounced=b[0]?.value??0;deferred=df[0]?.value??0;opens=o[0]?.value??0;clicks=c[0]?.value??0;}catch{dbError=true;}}
  const usable=databaseConfigured&&!dbError;
  const cards=[{l:"Messages",v:total,icon:BarChart3,t:"violet"},{l:"Delivered",v:delivered,icon:MailCheck,t:"emerald"},{l:"Bounced",v:bounced,icon:ShieldAlert,t:"rose"},{l:"Clicks",v:clicks,icon:MousePointerClick,t:"amber"}];
  return <AppShell session={session}><div className="mb-7"><p className="mb-2 text-xs font-extrabold uppercase tracking-[.18em] text-zinc-400">Analytics</p><h1 className="text-3xl font-black tracking-[-.035em] sm:text-4xl">Reports</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">Only persisted message and event records are counted. Local MTA acceptance is not presented as delivery.</p></div>{!usable?<div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Database not connected.</b> Analytics remain zero rather than being fabricated.</div>:null}<section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({l,v,icon:Icon})=><article key={l} className="premium-panel p-5"><div className="flex items-center justify-between"><p className="text-sm font-bold text-zinc-500">{l}</p><Icon className="h-5 w-5 text-zinc-400" /></div><p className="mt-3 text-3xl font-black tracking-[-.04em]">{v.toLocaleString()}</p></article>)}</section><section className="mt-5 grid gap-5 xl:grid-cols-2"><article className="premium-panel p-6"><p className="text-xs font-extrabold uppercase tracking-[.16em] text-zinc-400">Delivery state</p><h2 className="mt-2 text-xl font-black">Transport truth</h2><div className="mt-5 space-y-3">{[["Delivered",delivered],["Deferred",deferred],["Bounced",bounced],["MTA accepted",0]].map(([l,v])=><div key={String(l)} className="flex items-center justify-between rounded-xl border border-zinc-100 px-4 py-3 dark:border-zinc-800"><span className="text-sm font-bold">{l}</span><span className="text-sm font-black">{Number(v).toLocaleString()}</span></div>)}</div></article><article className="premium-panel p-6"><p className="text-xs font-extrabold uppercase tracking-[.16em] text-zinc-400">Engagement</p><h2 className="mt-2 text-xl font-black">Tracked events</h2><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900"><p className="text-xs font-bold text-zinc-400">Opens</p><p className="mt-2 text-2xl font-black">{opens.toLocaleString()}</p></div><div className="rounded-2xl bg-zinc-50 p-5 dark:bg-zinc-900"><p className="text-xs font-bold text-zinc-400">Clicks</p><p className="mt-2 text-2xl font-black">{clicks.toLocaleString()}</p></div></div><p className="mt-4 text-xs leading-5 text-zinc-400">Open tracking is inherently imperfect and is never described as exact inbox readership.</p></article></section></AppShell>;
}
