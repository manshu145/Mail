import { ShieldBan } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { db, databaseConfigured } from "@/db";
import { suppressions } from "@/db/schema";
import { desc } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export default async function SuppressionsPage() {
  const session = await getSession(); if (!session) redirect("/login");
  let rows: typeof suppressions.$inferSelect[] = []; let dbError = false;
  if (databaseConfigured) { try { rows = await db.select().from(suppressions).orderBy(desc(suppressions.createdAt)).limit(200); } catch { dbError = true; } }
  const usable = databaseConfigured && !dbError;
  return <AppShell session={session}>
    <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-extrabold uppercase tracking-[.18em] text-zinc-400">Compliance</p><h1 className="text-3xl font-black tracking-[-.035em] sm:text-4xl">Suppressions</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">Global do-not-send state for unsubscribes, hard bounces, invalid addresses, complaints and manual policy blocks.</p></div><ResourceCreate disabled={!usable} endpoint="/api/resources/suppressions" title="Suppress address" buttonLabel="Add suppression" fields={[{name:"email",label:"Email address",type:"email",required:true,placeholder:"recipient@example.com"},{name:"reason",label:"Reason",type:"select",options:[{label:"Manual",value:"manual"},{label:"Unsubscribe",value:"unsubscribe"},{label:"Hard bounce",value:"hard_bounce"},{label:"Invalid",value:"invalid"},{label:"Complaint",value:"complaint"},{label:"Policy",value:"policy"}]},{name:"note",label:"Note",type:"textarea",placeholder:"Optional context"}]} /></div>
    {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Database not connected.</b> Suppression writes stay disabled so preview data cannot misrepresent policy state.</div> : null}
    <section className="premium-panel overflow-hidden">{rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-zinc-50 text-[11px] font-extrabold uppercase tracking-[.12em] text-zinc-400 dark:bg-zinc-900/70"><tr><th className="px-5 py-3.5">Address</th><th className="px-5 py-3.5">Reason</th><th className="px-5 py-3.5">Source</th><th className="px-5 py-3.5">Added</th></tr></thead><tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">{rows.map((row) => <tr key={row.id}><td className="px-5 py-4 font-bold">{row.email}</td><td className="px-5 py-4"><span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold capitalize text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{row.reason.replaceAll("_"," ")}</span></td><td className="px-5 py-4 text-xs font-semibold text-zinc-500">{row.source}</td><td className="px-5 py-4 text-xs text-zinc-400">{new Intl.DateTimeFormat("en",{day:"2-digit",month:"short",year:"numeric"}).format(row.createdAt)}</td></tr>)}</tbody></table></div> : <div className="grid min-h-72 place-items-center p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300"><ShieldBan className="h-5 w-5" /></div><h2 className="mt-4 font-black">No suppressed addresses</h2><p className="mt-1 text-sm text-zinc-500">Global suppression records will appear here.</p></div></div>}</section>
  </AppShell>;
}
