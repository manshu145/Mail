import Link from "next/link";
import { desc, ilike, or, sql } from "drizzle-orm";
import { FileClock, Search, ShieldCheck, UserRoundCheck, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ContactsActions } from "@/components/contacts-actions";
import { ContactsTableManager } from "@/components/contacts-table-manager";
import { db, databaseConfigured } from "@/db";
import { contacts, importJobs, lists, suppressions } from "@/db/schema";
import { getSession } from "@/lib/auth";

function contactDisplayName(contact: typeof contacts.$inferSelect) {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return name || contact.email;
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession(); if (!session) redirect("/login"); const { q = "" } = await searchParams;
  let rows: typeof contacts.$inferSelect[] = [], jobs: typeof importJobs.$inferSelect[] = [], listRows: Array<{id:string;name:string;isDynamic:boolean}> = []; let total=0, active=0, suppressed=0, dbError=false;
  if (databaseConfigured) try {
    const query=q.trim();
    const filter=query?or(
      ilike(contacts.email,`%${query}%`),
      ilike(contacts.firstName,`%${query}%`),
      ilike(contacts.lastName,`%${query}%`),
      sql`lower(${contacts.attributes}::text) like ${`%${query.toLowerCase()}%`}`,
    ):undefined;
    const [data,recentJobs,audiences,t,a,s]=await Promise.all([db.select().from(contacts).where(filter).orderBy(desc(contacts.createdAt)).limit(100),db.select().from(importJobs).orderBy(desc(importJobs.createdAt)).limit(8),db.select({id:lists.id,name:lists.name,isDynamic:lists.isDynamic}).from(lists).orderBy(lists.name),db.select({value:sql<number>`count(*)::int`}).from(contacts),db.select({value:sql<number>`count(*)::int`}).from(contacts).where(sql`${contacts.status}='active'`),db.select({value:sql<number>`count(*)::int`}).from(suppressions)]);
    rows=data;jobs=recentJobs;listRows=audiences;total=t[0]?.value??0;active=a[0]?.value??0;suppressed=s[0]?.value??0;
  } catch (error) { console.error("[contacts-page]", error); dbError=true; }
  const usable=databaseConfigured&&!dbError;
  return <AppShell session={session}>
    <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="page-eyebrow mb-2">Audience</p><h1 className="page-title">Contacts</h1><p className="page-description">Normalized recipient records with persisted validation, source, imported custom fields and suppression state.</p></div><ContactsActions databaseConfigured={usable}/></div>
    {!usable?<section className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3.5 text-sm text-amber-900 dark:text-amber-200"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500"/><div><b>Contact storage unavailable.</b> Check the database connection.</div></section>:null}
    <section className="mb-4 grid gap-2.5 sm:grid-cols-3">{[{label:"Total contacts",value:total,icon:UsersRound,className:"bg-violet-500/10 text-violet-700 dark:text-violet-300"},{label:"Active",value:active,icon:UserRoundCheck,className:"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"},{label:"Suppressed",value:suppressed,icon:ShieldCheck,className:"bg-rose-500/10 text-rose-700 dark:text-rose-300"}].map(({label,value,icon:Icon,className})=><article key={label} className="metric-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-extrabold text-[var(--muted)]">{label}</p><p className="mt-2 text-2xl font-black tracking-[-0.04em]">{value.toLocaleString()}</p></div><div className={`grid h-10 w-10 place-items-center rounded-xl ${className}`}><Icon className="h-4 w-4"/></div></div></article>)}</section>
    {jobs.length?<section className="premium-panel mb-4 overflow-hidden"><div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3.5"><div className="flex items-center gap-2"><FileClock className="h-4 w-4 text-[var(--muted)]"/><h2 className="text-sm font-black">Recent CSV imports</h2></div><a href="/imports" className="text-xs font-extrabold text-violet-700 dark:text-violet-300">View all</a></div><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-xs"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">File</th><th>Status</th><th>Rows</th><th>Imported</th><th>Duplicates</th><th>Invalid</th><th>Created</th></tr></thead><tbody className="divide-y divide-[var(--border)]">{jobs.map(job=><tr key={job.id} className="transition hover:bg-[var(--surface-soft)]"><td className="px-5 py-3 font-bold">{job.filename}</td><td><span className={`rounded-full px-2 py-1 font-bold capitalize ${job.status==="completed"?"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300":job.status==="failed"?"bg-rose-500/10 text-rose-700 dark:text-rose-300":"bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{job.status}</span></td><td>{job.totalRows}</td><td>{job.importedRows}</td><td>{job.duplicateRows}</td><td>{job.invalidRows}</td><td className="text-[var(--muted)]">{new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short", timeZone:"Asia/Kolkata"}).format(job.createdAt)}</td></tr>)}</tbody></table></div></section>:null}
    <section className="premium-panel overflow-hidden"><div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 sm:flex-row sm:items-center sm:justify-between"><form className="relative w-full max-w-md"><Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]"/><input defaultValue={q} name="q" placeholder="Search name, email or custom field…" className="h-10 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-soft)] pl-10 pr-3 text-sm outline-none transition focus:border-violet-500/40 focus:ring-4 focus:ring-violet-500/[0.06]"/></form><span className="status-pill">Showing up to 100 records</span></div>
    {rows.length?<ContactsTableManager rows={rows.map(contact=>({id:contact.id,email:contact.email,name:contactDisplayName(contact),hasName:Boolean([contact.firstName,contact.lastName].filter(Boolean).join(" ").trim()),status:contact.status,validationStatus:contact.validationStatus,source:contact.source,createdAt:contact.createdAt.toISOString()}))} lists={listRows.filter(x=>!x.isDynamic).map(({id,name})=>({id,name}))} dynamicSegments={listRows.filter(x=>x.isDynamic).map(({id,name})=>({id,name}))}/>:<div className="grid min-h-72 place-items-center p-8 text-center"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><UsersRound className="h-6 w-6"/></div><h2 className="mt-4 text-lg font-black">No contacts yet</h2><p className="mt-2 text-sm text-[var(--muted)]">Import a CSV or create a contact.</p></div></div>}</section>
  </AppShell>;
}
