import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { db, databaseConfigured } from "@/db";
import { getSession } from "@/lib/auth";
import { providerLabel } from "@/lib/provider";

const n=(v:unknown)=>Number(v||0);
const providerSql = sql`case
 when lower(split_part(recipient_email,'@',2)) in ('gmail.com','googlemail.com') then 'gmail'
 when lower(split_part(recipient_email,'@',2)) in ('yahoo.com','ymail.com','rocketmail.com','aol.com') or lower(split_part(recipient_email,'@',2)) like 'yahoo.%' then 'yahoo'
 when lower(split_part(recipient_email,'@',2)) in ('outlook.com','hotmail.com','live.com','msn.com') or lower(split_part(recipient_email,'@',2)) like 'hotmail.%' or lower(split_part(recipient_email,'@',2)) like 'live.%' then 'microsoft'
 when lower(split_part(recipient_email,'@',2)) in ('proton.me','protonmail.com','pm.me') then 'proton'
 when lower(split_part(recipient_email,'@',2)) in ('rediffmail.com','rediff.com') then 'rediff'
 else 'domain:'||lower(split_part(recipient_email,'@',2)) end`;

export default async function DeliveryIntegrityPage(){
 const session=await getSession();if(!session)redirect('/login');
 let summary:Record<string,unknown>={},providers:Record<string,unknown>[]=[],stale:Record<string,unknown>[]=[],dbError=false;
 if(databaseConfigured)try{
  const [s,p,h]=await Promise.all([
   db.execute(sql`select count(*)::int created,
    count(*) filter(where status='queued')::int queued,
    count(*) filter(where status='ready_for_transport')::int ready,
    count(*) filter(where status='sending')::int sending,
    count(*) filter(where status='mta_accepted')::int accepted,
    count(*) filter(where status='mta_accepted' and accepted_at < now()-interval '30 minutes')::int stale_accepted,
    count(*) filter(where status='deferred')::int deferred,
    count(*) filter(where status='delivered')::int delivered,
    count(*) filter(where status='bounced')::int bounced,
    count(*) filter(where status='failed')::int failed from messages`),
   db.execute(sql`select ${providerSql} provider,count(*)::int created,
    count(*) filter(where status='mta_accepted')::int accepted,
    count(*) filter(where status='deferred')::int deferred,
    count(*) filter(where status='delivered')::int delivered,
    count(*) filter(where status='bounced')::int bounced,
    count(*) filter(where status='failed')::int failed
    from messages group by 1 order by created desc limit 30`),
   db.execute(sql`select id::text,recipient_email,status::text,provider_message_id,accepted_at,last_error from messages where status='mta_accepted' and accepted_at < now()-interval '30 minutes' order by accepted_at asc limit 100`)
  ]);summary=(s.rows[0]||{}) as Record<string,unknown>;providers=p.rows as Record<string,unknown>[];stale=h.rows as Record<string,unknown>[];
 }catch{dbError=true}
 const accepted=n(summary.accepted),staleAccepted=n(summary.stale_accepted),currentAccepted=Math.max(0,accepted-staleAccepted);
 const active=n(summary.queued)+n(summary.ready)+n(summary.sending)+n(summary.deferred)+currentAccepted;
 return <AppShell session={session}>
  <div className="mb-7"><p className="page-eyebrow mb-2">Delivery truth</p><h1 className="page-title">Delivery integrity</h1><p className="page-description">Separates current delivery work from historical unresolved MTA acceptance and shows provider-level final SMTP outcomes.</p></div>
  {!databaseConfigured||dbError?<div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Delivery integrity data is unavailable.</div>:null}
  <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[["Active in flight",active],["Current MTA accepted",currentAccepted],["Historical unresolved",staleAccepted],["Delivered",n(summary.delivered)],["Bounced",n(summary.bounced)]].map(([l,v])=><article key={String(l)} className="metric-card p-5"><p className="text-xs font-extrabold text-[var(--muted)]">{l}</p><p className="mt-3 text-3xl font-black">{Number(v).toLocaleString()}</p></article>)}</section>
  <section className="premium-panel mt-5 overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Provider performance</h2><p className="mt-1 text-xs text-[var(--muted)]">Lifetime delivery states by mailbox provider.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Provider</th><th>Created</th><th>MTA accepted</th><th>Deferred</th><th>Delivered</th><th>Bounced</th><th>Failed</th><th>Delivery rate</th></tr></thead><tbody>{providers.length?providers.map(p=>{const created=n(p.created),delivered=n(p.delivered);return <tr key={String(p.provider)} className="border-t border-[var(--border)]"><td className="px-5 py-3.5 font-black">{providerLabel(String(p.provider))}</td><td>{created}</td><td>{n(p.accepted)}</td><td>{n(p.deferred)}</td><td>{delivered}</td><td>{n(p.bounced)}</td><td>{n(p.failed)}</td><td>{created?(delivered/created*100).toFixed(2):'0.00'}%</td></tr>}):<tr><td colSpan={8} className="p-8 text-center text-[var(--muted)]">No provider data yet.</td></tr>}</tbody></table></div></section>
  <section className="premium-panel mt-5 overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Historical unresolved acceptance</h2><p className="mt-1 text-xs text-[var(--muted)]">Messages accepted by local Postfix more than 30 minutes ago without a captured final remote outcome.</p></div>{stale.length?<div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Recipient</th><th>Queue ID</th><th>Accepted</th><th>Last response</th><th></th></tr></thead><tbody>{stale.map(m=><tr key={String(m.id)} className="border-t border-[var(--border)]"><td className="px-5 py-3.5 font-bold">{String(m.recipient_email)}</td><td className="font-mono text-xs">{String(m.provider_message_id||'—')}</td><td className="text-xs text-[var(--muted)]">{m.accepted_at?new Intl.DateTimeFormat('en',{dateStyle:'medium',timeStyle:'short'}).format(new Date(String(m.accepted_at))):'—'}</td><td className="max-w-[420px] truncate text-xs text-rose-500">{String(m.last_error||'—')}</td><td className="pr-5"><Link href={`/messages/${String(m.id)}`} className="text-xs font-black text-violet-600 hover:underline">Inspect</Link></td></tr>)}</tbody></table></div>:<div className="p-8 text-center text-sm text-[var(--muted)]">No historical unresolved messages.</div>}</section>
 </AppShell>;
}
