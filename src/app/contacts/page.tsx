import Link from "next/link";
import { desc, ilike, or, sql } from "drizzle-orm";
import { FileClock, Search, ShieldCheck, UserRoundCheck, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ContactsActions } from "@/components/contacts-actions";
import { db, databaseConfigured } from "@/db";
import { contacts, importJobs, suppressions } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await getSession(); if (!session) redirect("/login");
  const { q = "" } = await searchParams;
  let rows: typeof contacts.$inferSelect[] = [], jobs: typeof importJobs.$inferSelect[] = [];
  let total = 0, active = 0, suppressed = 0, dbError = false;
  if (databaseConfigured) try {
    const filter = q.trim() ? or(ilike(contacts.email, `%${q.trim()}%`), ilike(contacts.firstName, `%${q.trim()}%`), ilike(contacts.lastName, `%${q.trim()}%`)) : undefined;
    const [data, recentJobs, t, a, s] = await Promise.all([
      db.select().from(contacts).where(filter).orderBy(desc(contacts.createdAt)).limit(100),
      db.select().from(importJobs).orderBy(desc(importJobs.createdAt)).limit(8),
      db.select({ value: sql<number>`count(*)::int` }).from(contacts),
      db.select({ value: sql<number>`count(*)::int` }).from(contacts).where(sql`${contacts.status}='active'`),
      db.select({ value: sql<number>`count(*)::int` }).from(suppressions),
    ]);
    rows = data; jobs = recentJobs; total = t[0]?.value ?? 0; active = a[0]?.value ?? 0; suppressed = s[0]?.value ?? 0;
  } catch { dbError = true; }
  const usable = databaseConfigured && !dbError;

  return <AppShell session={session}>
    <div className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="mb-2 text-xs font-extrabold uppercase tracking-[.18em] text-zinc-400">Audience</p><h1 className="text-3xl font-black tracking-[-.035em] sm:text-4xl">Contacts</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Normalized, deduplicated recipient records with persisted validation and policy state.</p></div>
      <ContactsActions databaseConfigured={usable} />
    </div>
    {!usable ? <section className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Database not connected.</b> Contact writes remain disabled.</section> : null}
    <section className="mb-5 grid gap-3 sm:grid-cols-3">{[{l:"Total contacts",v:total,i:UsersRound},{l:"Active",v:active,i:UserRoundCheck},{l:"Suppressed",v:suppressed,i:ShieldCheck}].map(({l,v,i:Icon}) => <article key={l} className="premium-panel p-5"><div className="flex justify-between"><div><p className="text-sm font-bold text-zinc-500">{l}</p><p className="mt-2 text-3xl font-black">{v.toLocaleString()}</p></div><Icon className="h-5 w-5 text-zinc-400" /></div></article>)}</section>

    {jobs.length ? <section className="premium-panel mb-5 overflow-hidden"><div className="flex items-center gap-2 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800"><FileClock className="h-4 w-4 text-zinc-400" /><h2 className="text-sm font-black">Recent CSV imports</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-xs"><thead className="bg-zinc-50 text-[10px] font-extrabold uppercase tracking-[.12em] text-zinc-400 dark:bg-zinc-900/70"><tr><th className="px-5 py-3">File</th><th>Status</th><th>Rows</th><th>Imported</th><th>Duplicates</th><th>Invalid</th><th>Created</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id} className="border-t border-zinc-100 dark:border-zinc-900"><td className="px-5 py-3 font-bold">{job.filename}</td><td><span className={`rounded-full px-2 py-1 font-bold capitalize ${job.status === "completed" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : job.status === "failed" ? "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"}`}>{job.status}</span></td><td>{job.totalRows}</td><td>{job.importedRows}</td><td>{job.duplicateRows}</td><td>{job.invalidRows}</td><td className="text-zinc-400">{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(job.createdAt)}</td></tr>)}</tbody></table></div></section> : null}

    <section className="premium-panel overflow-hidden"><div className="border-b border-zinc-200 p-4 dark:border-zinc-800"><form className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><input defaultValue={q} name="q" placeholder="Search name or email…" className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 pl-10 pr-3 text-sm dark:border-zinc-800 dark:bg-zinc-900" /></form></div>{rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-zinc-50 text-[11px] font-extrabold uppercase tracking-[.12em] text-zinc-400 dark:bg-zinc-900/70"><tr><th className="px-5 py-3.5">Contact</th><th>Status</th><th>Validation</th><th>Source</th><th>Added</th></tr></thead><tbody>{rows.map((c) => <tr key={c.id} className="border-t border-zinc-100 dark:border-zinc-900"><td className="px-5 py-4"><Link href={`/contacts/${c.id}`} className="font-black hover:underline">{[c.firstName,c.lastName].filter(Boolean).join(" ") || "Unnamed contact"}</Link><div className="text-xs text-zinc-500">{c.email}</div></td><td className="capitalize">{c.status}</td><td className="capitalize text-xs font-bold text-zinc-500">{c.validationStatus}</td><td className="text-xs text-zinc-500">{c.source.replaceAll("_"," ")}</td><td className="text-xs text-zinc-400">{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(c.createdAt)}</td></tr>)}</tbody></table></div> : <div className="grid min-h-72 place-items-center text-center"><div><UsersRound className="mx-auto h-8 w-8 text-zinc-400" /><h2 className="mt-4 font-black">No contacts yet</h2></div></div>}</section>
  </AppShell>;
}
