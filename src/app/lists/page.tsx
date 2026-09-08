import { Layers3, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ResourceCreate } from "@/components/resource-create";
import { db, databaseConfigured } from "@/db";
import { contactLists, lists } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function ListsPage() {
  const session = await getSession(); if (!session) redirect("/login");
  let listRows: typeof lists.$inferSelect[] = []; let memberships: typeof contactLists.$inferSelect[] = []; let dbError = false;
  if (databaseConfigured) { try { [listRows, memberships] = await Promise.all([db.select().from(lists), db.select().from(contactLists)]); } catch { dbError = true; } }
  const usable = databaseConfigured && !dbError;
  const counts = new Map<string, number>(); memberships.forEach((row) => counts.set(row.listId, (counts.get(row.listId) || 0) + 1));
  return <AppShell session={session}>
    <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-extrabold uppercase tracking-[.18em] text-zinc-400">Audience</p><h1 className="text-3xl font-black tracking-[-.035em] sm:text-4xl">Lists & segments</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">Static lists keep membership explicit. Dynamic segments are stored separately from contact records so contacts are never duplicated.</p></div><ResourceCreate disabled={!usable} endpoint="/api/resources/lists" title="Create list" buttonLabel="Create list" fields={[{name:"name",label:"List name",required:true,placeholder:"Customers - India"},{name:"description",label:"Description",type:"textarea",placeholder:"Who belongs in this audience?"},{name:"type",label:"Type",type:"select",options:[{label:"Static list",value:"static"},{label:"Dynamic segment",value:"dynamic"}]}]} /></div>
    {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Database not connected.</b> List creation is disabled until PostgreSQL is available.</div> : null}
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{listRows.length ? listRows.map((list) => <article key={list.id} className="premium-panel p-5"><div className="flex items-start justify-between gap-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-300"><Layers3 className="h-5 w-5" /></div><span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[.1em] text-zinc-500 dark:bg-zinc-900">{list.isDynamic ? "dynamic" : "static"}</span></div><h2 className="mt-5 text-lg font-black">{list.name}</h2><p className="mt-1 min-h-10 text-sm leading-5 text-zinc-500 dark:text-zinc-400">{list.description || "No description"}</p><div className="mt-5 flex items-center gap-2 border-t border-zinc-100 pt-4 text-sm font-bold text-zinc-500 dark:border-zinc-800"><UsersRound className="h-4 w-4" /> {(counts.get(list.id) || 0).toLocaleString()} members</div></article>) : <div className="premium-panel col-span-full grid min-h-72 place-items-center p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-zinc-100 text-zinc-500 dark:bg-zinc-900"><Layers3 className="h-5 w-5" /></div><h2 className="mt-4 font-black">No lists yet</h2><p className="mt-1 text-sm text-zinc-500">Create the first audience list when the database is connected.</p></div></div>}</section>
  </AppShell>;
}
