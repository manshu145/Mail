import Link from "next/link";
import { Activity, ArrowLeft, Clock3, Eye, MousePointerClick } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { MessageStatusBadge } from "@/components/message-status-badge";
import { db, databaseConfigured } from "@/db";
import { campaigns, contacts, messageEvents, messages } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { providerForEmail, providerLabel } from "@/lib/provider";

const fmt=(value:Date|string|null|undefined)=>value?new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeStyle:"medium",timeZone:"Asia/Kolkata"}).format(new Date(value)):"—";
function eventTone(type:string){
  if(type.includes("bounce")||type.includes("failed")||type.includes("cancel"))return "bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if(type.includes("deliver")||type==="open"||type==="click")return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if(type.includes("defer")||type.includes("cooldown")||type.includes("thrott"))return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-violet-500/10 text-violet-700 dark:text-violet-300";
}
function details(payload:Record<string,unknown>){
  const lines:Array<[string,string]>=[];
  const keys:Array<[string,string]>=[["provider","Provider"],["queueId","MTA queue ID"],["dsn","DSN"],["attempt","Attempt"],["retryInSeconds","Retry in seconds"],["retryAt","Retry at"],["nextProbeAt","Next probe"],["cooldownKey","Cooldown"],["restrictionScope","Restriction scope"],["restrictionReason","Restriction reason"],["bounceKind","Bounce kind"],["source","Source"]];
  for(const [key,label] of keys){const value=payload[key];if(value!==undefined&&value!==null&&value!=="")lines.push([label,String(value)]);}
  const long=["line","response","detail","error","reason"].map(k=>payload[k]).find(v=>typeof v==="string"&&v);
  return {lines,long:typeof long==="string"?long:""};
}

export default async function MessageDetailPage({params}:{params:Promise<{id:string}>}){
  const session=await getSession();if(!session)redirect("/login");if(!databaseConfigured)redirect("/messages");
  const {id}=await params;
  const [row]=await db.select({message:messages,campaignName:campaigns.name,campaignSubject:campaigns.subject,contactFirstName:contacts.firstName,contactLastName:contacts.lastName,contactEmail:contacts.email,contactValidation:contacts.validationStatus}).from(messages).innerJoin(campaigns,eq(campaigns.id,messages.campaignId)).innerJoin(contacts,eq(contacts.id,messages.contactId)).where(eq(messages.id,id)).limit(1);
  if(!row)notFound();
  const [events,stats]=await Promise.all([
    db.select().from(messageEvents).where(eq(messageEvents.messageId,id)).orderBy(desc(messageEvents.createdAt)).limit(500),
    db.execute(sql`select
      count(*) filter(where type='open' and coalesce((payload->>'qualified')::boolean,coalesce((payload->>'automated')::boolean,false)=false)=true)::int human_opens,
      count(*) filter(where type='click' and coalesce((payload->>'qualified')::boolean,coalesce((payload->>'automated')::boolean,false)=false)=true)::int human_clicks,
      count(*) filter(where type='open' and coalesce((payload->>'qualified')::boolean,coalesce((payload->>'automated')::boolean,false)=false)=false)::int automated_opens,
      count(*) filter(where type='click' and coalesce((payload->>'qualified')::boolean,coalesce((payload->>'automated')::boolean,false)=false)=false)::int automated_clicks,
      min(created_at) filter(where type='open' and coalesce((payload->>'qualified')::boolean,coalesce((payload->>'automated')::boolean,false)=false)=true) first_open,
      max(created_at) filter(where type='open' and coalesce((payload->>'qualified')::boolean,coalesce((payload->>'automated')::boolean,false)=false)=true) last_open,
      min(created_at) filter(where type='click' and coalesce((payload->>'qualified')::boolean,coalesce((payload->>'automated')::boolean,false)=false)=true) first_click,
      max(created_at) filter(where type='click' and coalesce((payload->>'qualified')::boolean,coalesce((payload->>'automated')::boolean,false)=false)=true) last_click
      from message_events where message_id=${id}`)
  ]);
  const s=(stats.rows[0]||{}) as Record<string,unknown>,m=row.message;
  const provider=providerForEmail(m.recipientEmail),displayName=[row.contactFirstName,row.contactLastName].filter(Boolean).join(" ")||row.contactEmail;
  const timeline=[
    ...events.map(e=>({id:e.id,type:e.type,payload:e.payload||{},createdAt:e.createdAt})),
    {id:"queued",type:"queued",payload:{status:"queued"},createdAt:m.queuedAt}
  ].sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());

  return <AppShell session={session}>
    <div className="page-intro"><div><Link href="/messages" className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-[var(--muted)]"><ArrowLeft className="h-4 w-4"/>Message log</Link><div className="mb-2 flex items-center gap-2"><p className="page-eyebrow">Delivery journey</p><span className="status-pill"><Activity className="h-3 w-3"/>Full lifecycle</span></div><h1 className="page-title">{displayName}</h1><p className="page-description">{m.recipientEmail} · {providerLabel(provider)} · <Link className="font-bold hover:underline" href={`/campaigns/${m.campaignId}`}>{row.campaignName}</Link></p></div><MessageStatusBadge status={m.status}/></div>

    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[[Eye,"Human opens",s.human_opens],[MousePointerClick,"Human clicks",s.human_clicks],[Eye,"Automated opens",s.automated_opens],[MousePointerClick,"Automated clicks",s.automated_clicks]].map(([Icon,label,value])=>{const C=Icon as typeof Eye;return <article key={String(label)} className="metric-card surface-lift p-5"><div className="flex justify-between"><div><p className="text-xs font-extrabold text-[var(--muted)]">{String(label)}</p><p className="mt-3 text-3xl font-black">{Number(value||0).toLocaleString()}</p></div><C className="h-5 w-5 text-[var(--muted)]"/></div></article>})}</section>

    <section className="grid gap-5 xl:grid-cols-[.75fr_1.25fr]">
      <div className="space-y-5">
        <article className="section-card p-5 sm:p-6"><h2 className="font-black">Delivery details</h2><div className="mt-5 space-y-3 text-sm">{[["Campaign",row.campaignName],["Subject",row.campaignSubject],["Mailbox provider",providerLabel(provider)],["Validation",row.contactValidation],["Current status",m.status.replaceAll("_"," ")],["MTA queue ID",m.providerMessageId||"—"],["Queued",fmt(m.queuedAt)],["MTA accepted",fmt(m.acceptedAt)],["Delivered",fmt(m.deliveredAt)],["Bounced",fmt(m.bouncedAt)],["Current transport detail",m.lastError||"—"]].map(([a,b])=><div key={String(a)} className="flex gap-4 border-b border-[var(--border)] pb-3 last:border-0"><span className="w-36 shrink-0 text-[var(--muted)]">{a}</span><b className="break-all">{String(b)}</b></div>)}</div></article>
        <article className="section-card p-5 sm:p-6"><h2 className="font-black">Engagement timestamps</h2><div className="mt-5 grid gap-3 text-sm">{[["First open",s.first_open],["Last open",s.last_open],["First click",s.first_click],["Last click",s.last_click]].map(([l,v])=><div key={String(l)}><span className="text-[var(--muted)]">{String(l)}</span><b className="mt-1 block">{v?fmt(String(v)):"Never"}</b></div>)}</div></article>
      </div>

      <article className="section-card overflow-hidden"><div className="section-card-header"><div><div className="flex items-center gap-2"><span className="live-dot"/><h2 className="section-card-title">Complete delivery timeline</h2></div><p className="section-card-copy">Transport, Postfix/provider responses, retries, final delivery and engagement events. Nothing is hidden.</p></div></div>{timeline.length?<div className="status-rail p-4 sm:p-5">{timeline.map(e=>{const p=e.payload as Record<string,unknown>;const info=details(p);const automated=Boolean(p.automated);const url=typeof p.url==="string"?p.url:null;return <div key={e.id} className="status-rail-item pb-5 last:pb-0"><div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${eventTone(e.type)}`}>{e.type.replaceAll("_"," ")}</span>{automated?<span className="text-[11px] font-bold text-amber-600">automated</span>:null}</div>{info.lines.length?<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{info.lines.map(([l,v])=><span key={l} className="text-[11px] text-[var(--muted)]"><b className="text-[var(--foreground)]">{l}:</b> {v}</span>)}</div>:null}{info.long?<pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--surface-soft)] p-3 text-[10px] leading-5 text-[var(--muted)]">{info.long}</pre>:null}{url?<a href={url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm font-bold text-violet-600 hover:underline">{url}</a>:null}</div><time className="shrink-0 text-[10px] font-semibold text-[var(--muted)]">{fmt(e.createdAt)}</time></div></div></div>})}</div>:<div className="grid min-h-48 place-items-center p-8 text-center text-sm text-[var(--muted)]"><Clock3 className="mb-3 h-7 w-7"/>No activity recorded yet.</div>}</article>
    </section>
  </AppShell>;
}
