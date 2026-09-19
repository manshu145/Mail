import Link from "next/link";
import { sql } from "drizzle-orm";
import { CircleGauge, MailCheck, Search, ShieldAlert, Send } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { MessageActions } from "@/components/message-actions";
import { MessageStatusBadge } from "@/components/message-status-badge";
import { db, databaseConfigured } from "@/db";
import { getSession } from "@/lib/auth";
import { providerForEmail, providerLabel } from "@/lib/provider";

const statuses=["queued","ready_for_transport","sending","mta_accepted","deferred","delivered","bounced","failed","cancelled"] as const;
const fmt=(value:unknown)=>value?new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(new Date(String(value))):"—";
function payloadDetail(payload:unknown){
  const p=(payload&&typeof payload==="object"?payload:{}) as Record<string,unknown>;
  for(const key of ["line","response","detail","error","reason"]){if(typeof p[key]==="string"&&p[key])return String(p[key]);}
  if(typeof p.retryAt==="string")return `Retry at ${fmt(p.retryAt)}`;
  return "";
}
function stage(status:string,lastError:unknown,lastEvent:unknown){
  const error=String(lastError||"");
  if(error.startsWith("provider_cooldown:"))return "Provider paused";
  if(error==="sender_cooldown")return "Sender paused";
  if(error==="sending_account_rate_limited")return "Sender limit reached";
  if(lastEvent==="provider_probe")return "Restriction probe";
  return status.replaceAll("_"," ");
}

export default async function MessagesPage({searchParams}:{searchParams:Promise<{q?:string;status?:string}>}){
  const session=await getSession();if(!session)redirect("/login");
  const {q="",status=""}=await searchParams;
  const validStatus=statuses.includes(status as typeof statuses[number])?status:"";
  const qWhere=q.trim()?sql`and m.recipient_email ilike ${`%${q.trim()}%`}`:sql``;
  const statusWhere=validStatus?sql`and m.status::text=${validStatus}`:sql``;

  let rows:Array<Record<string,unknown>>=[];
  let inFlight=0,delivered=0,failed=0,dbError=false;
  if(databaseConfigured)try{
    const [data,summary]=await Promise.all([
      db.execute(sql`
        select m.id::text,m.recipient_email,m.status::text,m.provider_message_id,m.last_error,m.queued_at,m.accepted_at,m.delivered_at,m.bounced_at,
          le.type last_event_type,le.payload last_event_payload,le.created_at last_event_at
        from messages m
        left join lateral (
          select e.type,e.payload,e.created_at
          from message_events e
          where e.message_id=m.id
          order by e.created_at desc
          limit 1
        ) le on true
        where true ${qWhere} ${statusWhere}
        order by coalesce(le.created_at,m.queued_at) desc
        limit 250
      `),
      db.execute(sql`select
        count(*) filter(where status in ('queued','ready_for_transport','sending','mta_accepted','deferred'))::int in_flight,
        count(*) filter(where status='delivered')::int delivered,
        count(*) filter(where status in ('failed','bounced'))::int failed
        from messages`)
    ]);
    rows=data.rows as Array<Record<string,unknown>>;
    const t=(summary.rows[0]||{}) as Record<string,unknown>;inFlight=Number(t.in_flight||0);delivered=Number(t.delivered||0);failed=Number(t.failed||0);
  }catch(error){console.error("[messages]",error);dbError=true}
  const usable=databaseConfigured&&!dbError;

  return <AppShell session={session}>
    <div className="mb-7"><p className="page-eyebrow mb-2">Messaging operations</p><h1 className="page-title">Message log</h1><p className="page-description">Live recipient-level delivery journey from queue creation through SMTP transport, provider response and engagement.</p></div>
    {!usable?<div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Message data is temporarily unavailable.</b></div>:null}

    <section className="mb-5 grid gap-3 sm:grid-cols-3">{[[CircleGauge,"In flight",inFlight],[MailCheck,"Delivered",delivered],[ShieldAlert,"Bounce / failed",failed]].map(([Icon,label,value])=>{const C=Icon as typeof CircleGauge;return <article key={String(label)} className="metric-card p-5"><div className="flex items-start justify-between"><div><p className="text-[12px] font-extrabold text-[var(--muted)]">{String(label)}</p><p className="mt-3 text-3xl font-black">{usable?Number(value).toLocaleString():"—"}</p></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/[0.08] text-violet-700"><C className="h-4.5 w-4.5"/></div></div></article>})}</section>

    <section className="premium-panel overflow-hidden">
      <div className="border-b border-[var(--border)] p-4 sm:px-5"><form className="flex flex-col gap-2 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"/><input defaultValue={q} name="q" placeholder="Search recipient email…" className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] py-2.5 pl-10 pr-3 text-sm outline-none"/></div><select defaultValue={status} name="status" className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5 text-sm font-bold"><option value="">All statuses</option>{statuses.map(x=><option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</select><button className="btn-secondary">Filter</button></form></div>
      {rows.length?<div className="overflow-x-auto"><table className="w-full min-w-[1380px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.13em] text-[var(--muted)]"><tr><th className="px-5 py-3.5">Recipient</th><th>Provider</th><th>Status</th><th>Current stage</th><th>Last event</th><th>Last response / detail</th><th>Last update</th><th></th></tr></thead><tbody>{rows.map(row=>{const provider=providerForEmail(String(row.recipient_email));const detail=payloadDetail(row.last_event_payload)||String(row.last_error||"");return <tr key={String(row.id)} className="border-t border-[var(--border)] align-top"><td className="px-5 py-4"><Link href={`/messages/${String(row.id)}`} className="font-extrabold hover:text-violet-600 hover:underline">{String(row.recipient_email)}</Link><div className="mt-1 font-mono text-[10px] text-[var(--muted)]">{String(row.provider_message_id||row.id)}</div></td><td className="text-xs font-bold text-[var(--muted)]">{providerLabel(provider)}</td><td><MessageStatusBadge status={String(row.status)}/></td><td className="text-xs font-black capitalize">{stage(String(row.status),row.last_error,row.last_event_type)}</td><td className="text-xs font-bold">{String(row.last_event_type||"queued").replaceAll("_"," ")}</td><td className="max-w-[360px]"><p title={detail} className="line-clamp-3 break-words text-xs leading-5 text-[var(--muted)]">{detail||"—"}</p></td><td className="whitespace-nowrap text-xs text-[var(--muted)]">{fmt(row.last_event_at||row.queued_at)}</td><td className="pr-5"><div className="flex items-center gap-2"><Link className="btn-secondary px-3 py-2 text-xs" href={`/messages/${String(row.id)}`}>Timeline</Link><MessageActions id={String(row.id)} status={String(row.status)}/></div></td></tr>})}</tbody></table></div>:<div className="grid min-h-64 place-items-center p-8 text-center"><div><Send className="mx-auto h-8 w-8 text-[var(--muted)]"/><h3 className="mt-4 font-black">No matching messages</h3></div></div>}
    </section>
  </AppShell>;
}
