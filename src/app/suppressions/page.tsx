import { ShieldBan } from "lucide-react";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { SuppressionRemove } from "@/components/suppression-remove";
import { db,databaseConfigured } from "@/db";
import { suppressions } from "@/db/schema";
import { getSession } from "@/lib/auth";

const fmt=(value:Date)=>new Intl.DateTimeFormat("en-IN",{dateStyle:"medium",timeZone:"Asia/Kolkata"}).format(value);

export default async function SuppressionsPage(){
  const session=await getSession();if(!session)redirect("/login");
  let rows:typeof suppressions.$inferSelect[]=[];let bad=false;
  if(databaseConfigured)try{rows=await db.select().from(suppressions).orderBy(desc(suppressions.createdAt)).limit(200)}catch{bad=true}
  const usable=databaseConfigured&&!bad;
  return <AppShell session={session}>
    <div className="page-intro">
      <div><p className="page-eyebrow mb-2">Compliance</p><h1 className="page-title">Suppressions</h1><p className="page-description">Global do-not-send protection for unsubscribes, bounces, complaints, invalid addresses and manual blocks.</p></div>
      <ResourceCreate disabled={!usable || session.role !== "owner"} endpoint="/api/resources/suppressions" title="Suppress address" buttonLabel="Add suppression" fields={[{name:"email",label:"Email",type:"email",required:true},{name:"reason",label:"Reason",type:"select",options:["manual","unsubscribe","hard_bounce","bounce","invalid","complaint","policy"]},{name:"note",label:"Note",type:"textarea"}]}/>
    </div>
    {!usable?<div className="mb-5 rounded-2xl border border-amber-500/20 bg-amber-500/[.07] px-4 py-3.5 text-sm text-amber-800 dark:text-amber-200"><b>Suppression data is temporarily unavailable.</b></div>:null}
    <section className="section-card overflow-hidden">
      <div className="section-card-header"><div><h2 className="section-card-title">Blocked recipients</h2><p className="section-card-copy">{rows.length.toLocaleString()} recent suppression records · removal is owner-only and audited.</p></div><span className="status-pill"><ShieldBan className="h-3.5 w-3.5"/>Protected</span></div>
      {rows.length?<><div className="desktop-table-only overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3.5">Address</th><th>Reason</th><th>Source</th><th>Added</th><th>Control</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} className="interactive-row border-t border-[var(--border)]"><td className="px-5 py-4 font-bold">{r.email}</td><td><span className="rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1 text-[11px] font-bold capitalize">{r.reason.replaceAll("_"," ")}</span></td><td className="text-xs text-[var(--muted)]">{r.source.replaceAll("_"," ")}</td><td className="text-xs text-[var(--muted)]">{fmt(r.createdAt)}</td><td>{session.role==="owner"?<SuppressionRemove id={r.id} email={r.email}/>:<span className="text-xs text-[var(--muted)]">Owner only</span>}</td></tr>)}</tbody></table></div>
      <div className="mobile-card-list p-3">{rows.map(r=><article key={r.id} className="panel-soft p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-all text-xs font-black">{r.email}</p><p className="mt-1 text-[10px] capitalize text-[var(--muted)]">{r.reason.replaceAll("_"," ")} · {r.source.replaceAll("_"," ")}</p></div><ShieldBan className="h-4 w-4 shrink-0 text-rose-500"/></div><div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3"><span className="text-[10px] text-[var(--muted)]">{fmt(r.createdAt)}</span>{session.role==="owner"?<SuppressionRemove id={r.id} email={r.email}/>:null}</div></article>)}</div></>:<div className="grid min-h-72 place-items-center p-8 text-center"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600"><ShieldBan className="h-6 w-6"/></div><h2 className="mt-4 font-black">No suppressed addresses</h2><p className="mt-1 text-sm text-[var(--muted)]">Addresses blocked by unsubscribe, bounce or policy will appear here.</p></div></div>}
    </section>
  </AppShell>;
}
