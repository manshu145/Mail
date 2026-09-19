import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { Search, UserMinus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { db, databaseConfigured } from "@/db";
import { getSession } from "@/lib/auth";

const fmt=(value:unknown)=>value?new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(new Date(String(value))):"—";

export default async function UnsubscribersPage({searchParams}:{searchParams:Promise<{q?:string}>}) {
  const session=await getSession();
  if(!session)redirect("/login");
  const {q=""}=await searchParams;
  const needle=q.trim();

  let rows:Array<Record<string,unknown>>=[];
  let total=0;
  let dbError=false;
  if(databaseConfigured){
    try{
      const filter=needle?sql`and (s.email ilike ${`%${needle}%`} or coalesce(ct.first_name,'') ilike ${`%${needle}%`} or coalesce(ct.last_name,'') ilike ${`%${needle}%`})`:sql``;
      const [data,count]=await Promise.all([
        db.execute(sql`
          select s.id::text,s.email,s.source,s.note,s.created_at,
            ct.id::text contact_id,
            nullif(trim(concat_ws(' ',ct.first_name,ct.last_name)),'') contact_name,
            latest.message_id,latest.campaign_id,latest.campaign_name,latest.event_at
          from suppressions s
          left join contacts ct on ct.normalized_email=s.normalized_email
          left join lateral (
            select m.id::text message_id,m.campaign_id::text campaign_id,c.name campaign_name,e.created_at event_at
            from message_events e
            join messages m on m.id=e.message_id
            join campaigns c on c.id=m.campaign_id
            where e.type='unsubscribe' and lower(m.recipient_email)=s.normalized_email
            order by e.created_at desc
            limit 1
          ) latest on true
          where s.reason='unsubscribe' ${filter}
          order by s.created_at desc
          limit 500
        `),
        db.execute(sql`select count(*)::int total from suppressions where reason='unsubscribe'`)
      ]);
      rows=data.rows as Array<Record<string,unknown>>;
      total=Number((count.rows[0] as Record<string,unknown>|undefined)?.total||0);
    }catch(error){console.error("[unsubscribers]",error);dbError=true}
  }
  const usable=databaseConfigured&&!dbError;

  return <AppShell session={session}>
    <div className="page-intro">
      <div>
        <p className="page-eyebrow mb-2">Compliance</p>
        <h1 className="page-title">Unsubscribers</h1>
        <p className="page-description">People who explicitly unsubscribed are globally blocked from future campaign sends.</p>
      </div>
      <div className="metric-card min-w-[180px] p-4"><p className="text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">Total unsubscribed</p><p className="metric-value mt-2 text-2xl font-black">{usable?total.toLocaleString():"—"}</p></div>
    </div>

    {!usable?<div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Unsubscriber data is temporarily unavailable.</b></div>:null}

    <section className="section-card overflow-hidden">
      <div className="border-b border-[var(--border)] p-4 sm:px-5">
        <form className="flex gap-2">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"/><input name="q" defaultValue={q} placeholder="Search email or name…" className="form-control pl-10"/></div>
          <button className="btn-secondary">Search</button>
        </form>
      </div>
      {rows.length?<><div className="desktop-table-only overflow-x-auto"><table className="w-full min-w-[960px] text-left text-sm">
        <thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3.5">Subscriber</th><th>Source</th><th>Unsubscribed</th><th>Campaign</th><th>Message</th></tr></thead>
        <tbody>{rows.map((row)=><tr key={String(row.id)} className="interactive-row border-t border-[var(--border)]">
          <td className="px-5 py-4"><p className="font-black">{String(row.contact_name||row.email)}</p><p className="mt-1 text-xs text-[var(--muted)]">{String(row.email)}</p></td>
          <td className="text-xs font-bold">{String(row.source||"unsubscribe_link").replaceAll("_"," ")}</td>
          <td className="text-xs text-[var(--muted)]">{fmt(row.event_at||row.created_at)}</td>
          <td>{row.campaign_id?<Link className="font-bold text-violet-600 hover:underline" href={`/campaigns/${String(row.campaign_id)}`}>{String(row.campaign_name||"Campaign")}</Link>:<span className="text-[var(--muted)]">—</span>}</td>
          <td>{row.message_id?<Link className="text-xs font-bold text-violet-600 hover:underline" href={`/messages/${String(row.message_id)}`}>View timeline</Link>:<span className="text-[var(--muted)]">—</span>}</td>
        </tr>)}</tbody>
      </table></div><div className="mobile-card-list p-3">{rows.map((row)=><article key={String(row.id)} className="panel-soft p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black">{String(row.contact_name||row.email)}</p><p className="mt-1 break-all text-[10px] text-[var(--muted)]">{String(row.email)}</p></div><UserMinus className="h-4 w-4 shrink-0 text-rose-500"/></div><div className="mt-3 grid gap-2 text-[10px] text-[var(--muted)]"><div className="flex justify-between"><span>Unsubscribed</span><b className="text-[var(--foreground)]">{fmt(row.event_at||row.created_at)}</b></div><div className="flex justify-between"><span>Source</span><b className="capitalize text-[var(--foreground)]">{String(row.source||"unsubscribe_link").replaceAll("_"," ")}</b></div></div><div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">{row.campaign_id?<Link className="btn-secondary !min-h-8 !px-2.5 !py-1 text-[10px]" href={`/campaigns/${String(row.campaign_id)}`}>Campaign</Link>:null}{row.message_id?<Link className="btn-secondary !min-h-8 !px-2.5 !py-1 text-[10px]" href={`/messages/${String(row.message_id)}`}>Timeline</Link>:null}</div></article>)}</div></>:<div className="grid min-h-64 place-items-center p-8 text-center"><div><UserMinus className="mx-auto h-9 w-9 text-[var(--muted)]"/><h2 className="mt-4 font-black">No unsubscribers found</h2><p className="mt-1 text-sm text-[var(--muted)]">Explicit unsubscribe requests will appear here automatically.</p></div></div>}
    </section>
  </AppShell>;
}
