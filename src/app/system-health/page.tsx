import { Activity, CheckCircle2, CircleAlert, ServerCog } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { databaseConfigured, pool } from "@/db";
import { getSession } from "@/lib/auth";
import { getRedis, isRedisConfigured } from "@/lib/redis";

export const dynamic = "force-dynamic";

export default async function SystemHealthPage() {
  const session=await getSession(); if(!session) redirect("/login");
  let postgres: "online"|"offline"|"not_configured" = databaseConfigured?"offline":"not_configured";
  let redis: "online"|"offline"|"not_configured" = isRedisConfigured()?"offline":"not_configured";
  if(databaseConfigured){try{await pool.query("select 1");postgres="online";}catch{postgres="offline";}}
  if(isRedisConfigured()){try{const client=getRedis(); if(client.status==="wait") await client.connect(); redis=(await client.ping())==="PONG"?"online":"offline";}catch{redis="offline";}}
  const items=[{name:"Application",status:"online",detail:"Next.js control plane",icon:Activity},{name:"PostgreSQL",status:postgres,detail:"Persistent application data",icon:ServerCog},{name:"Redis",status:redis,detail:"Queues and temporary state",icon:ServerCog},{name:"Campaign workers",status:"not_configured",detail:"Runs on final worker infrastructure",icon:ServerCog},{name:"Postfix",status:"not_configured",detail:"Final VPS transport layer",icon:ServerCog}];
  return <AppShell session={session}><div className="mb-7"><p className="mb-2 text-xs font-extrabold uppercase tracking-[.18em] text-zinc-400">Operations</p><h1 className="text-3xl font-black tracking-[-.035em] sm:text-4xl">System health</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">Runtime checks distinguish online, offline and not configured. Preview hosting does not claim workers or Postfix are running.</p></div><section className="grid gap-4 lg:grid-cols-2">{items.map(({name,status,detail,icon:Icon})=>{const online=status==="online";const bad=status==="offline";return <article key={name} className="premium-panel p-5"><div className="flex items-start justify-between gap-4"><div className="flex items-center gap-4"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"><Icon className="h-5 w-5" /></div><div><h2 className="font-black">{name}</h2><p className="mt-1 text-sm text-zinc-500">{detail}</p></div></div><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold ${online?"bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300":bad?"bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300":"bg-zinc-100 text-zinc-500 dark:bg-zinc-900"}`}>{online?<CheckCircle2 className="h-3.5 w-3.5"/>:<CircleAlert className="h-3.5 w-3.5"/>}{status.replaceAll("_"," ")}</span></div></article>})}</section></AppShell>;
}
