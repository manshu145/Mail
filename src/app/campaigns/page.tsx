import { Send, TimerReset } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { db, databaseConfigured } from "@/db";
import { campaigns } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function CampaignsPage() {
  const session = await getSession(); if (!session) redirect("/login");
  let rows: typeof campaigns.$inferSelect[] = []; let dbError = false;
  if (databaseConfigured) { try { rows = await db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(100); } catch { dbError = true; } }
  const usable = databaseConfigured && !dbError;
  return <AppShell session={session}>
    <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-extrabold uppercase tracking-[.18em] text-zinc-400">Messaging</p><h1 className="text-3xl font-black tracking-[-.035em] sm:text-4xl">Campaigns</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">Campaigns start as drafts. Sending only moves through queue and transport workers—never directly from a web request.</p></div><ResourceCreate disabled={!usable} endpoint="/api/resources/campaigns" title="Create campaign draft" buttonLabel="Create campaign" fields={[{name:"name",label:"Internal campaign name",required:true,placeholder:"September customers"},{name:"subject",label:"Subject",required:true,placeholder:"Your subject line"},{name:"preheader",label:"Preheader",placeholder:"Optional preview text"}]} /></div>
    {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Database not connected.</b> Draft creation is disabled; no campaign state is simulated.</div> : null}
    <section className="premium-panel overflow-hidden">{rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[840px] text-left text-sm"><thead className="bg-zinc-50 text-[11px] font-extrabold uppercase tracking-[.12em] text-zinc-400 dark:bg-zinc-900/70"><tr><th className="px-5 py-3.5">Campaign</th><th className="px-5 py-3.5">Subject</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5">Schedule</th><th className="px-5 py-3.5">Created</th></tr></thead><tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">{rows.map((row) => <tr key={row.id} className="transition hover:bg-zinc-50/70 dark:hover:bg-zinc-900/40"><td className="px-5 py-4 font-black"><Link href={`/campaigns/${row.id}`} className="hover:underline">{row.name}</Link></td><td className="px-5 py-4 text-zinc-600 dark:text-zinc-300">{row.subject}</td><td className="px-5 py-4"><span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold capitalize text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">{row.status}</span></td><td className="px-5 py-4 text-xs text-zinc-500">{row.scheduledAt ? new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short"}).format(row.scheduledAt) : "Not scheduled"}</td><td className="px-5 py-4 text-xs text-zinc-400">{new Intl.DateTimeFormat("en",{day:"2-digit",month:"short",year:"numeric"}).format(row.createdAt)}</td></tr>)}</tbody></table></div> : <div className="grid min-h-72 place-items-center p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-300"><Send className="h-5 w-5" /></div><h2 className="mt-4 font-black">No campaigns yet</h2><p className="mt-1 text-sm text-zinc-500">Create a draft first; queue and transport stages remain explicit.</p><div className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-zinc-400"><TimerReset className="h-4 w-4" /> Web requests never bulk-send mail</div></div></div>}</section>
  </AppShell>;
}
