import Link from "next/link";
import { Layers3, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AudienceActions } from "@/components/audience-actions";
import { ResourceCreate } from "@/components/resource-create";
import { db, databaseConfigured } from "@/db";
import { contactLists, lists } from "@/db/schema";
import { sql } from "drizzle-orm";
import { getSession } from "@/lib/auth";

export default async function ListsPage() {
  const session = await getSession(); if (!session) redirect("/login");
  let listRows: typeof lists.$inferSelect[] = [];
  let countRows: Array<{ listId: string; count: number }> = [];
  let dbError = false;
  if (databaseConfigured) {
    try {
      [listRows, countRows] = await Promise.all([
        db.select().from(lists),
        db.select({ listId: contactLists.listId, count: sql<number>`count(*)::int` }).from(contactLists).groupBy(contactLists.listId),
      ]);
    } catch { dbError = true; }
  }
  const usable = databaseConfigured && !dbError;
  const counts = new Map(countRows.map((row) => [row.listId, Number(row.count || 0)]));

  return <AppShell session={session}>
    <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="page-eyebrow mb-2">Audience</p>
        <h1 className="page-title">Lists & segments</h1>
        <p className="page-description">Static memberships and persisted dynamic rules resolve without duplicating contacts.</p>
      </div>
      <ResourceCreate disabled={!usable} endpoint="/api/lists" title="Create list / segment" buttonLabel="Create audience" fields={[
        {name:"name",label:"Name",required:true},
        {name:"description",label:"Description",type:"textarea"},
        {name:"type",label:"Type",type:"select",options:[{label:"Static list",value:"static"},{label:"Dynamic segment",value:"dynamic"}]},
        {name:"field",label:"Dynamic rule field",type:"select",options:[{label:"Email domain",value:"email_domain"},{label:"Validation status",value:"validation_status"},{label:"Contact status",value:"contact_status"},{label:"Custom attribute",value:"custom_attribute"}]},
        {name:"attributeKey",label:"Custom attribute key",placeholder:"city / category / industry"},
        {name:"operator",label:"Operator",type:"select",options:["equals","not_equals"]},
        {name:"value",label:"Rule value",placeholder:"gmail.com / valid / active"},
      ]}/>
    </div>

    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {listRows.length ? listRows.map((list) =>
        <article key={list.id} className="premium-panel p-5">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/lists/${list.id}`} className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-600 transition hover:scale-105 dark:bg-violet-950/30 dark:text-violet-300">
              <Layers3 className="h-5 w-5"/>
            </Link>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-extrabold uppercase text-zinc-500 dark:bg-zinc-900">{list.isDynamic ? "dynamic" : "static"}</span>
          </div>
          <Link href={`/lists/${list.id}`} className="mt-5 block text-lg font-black hover:text-violet-700 dark:hover:text-violet-300">{list.name}</Link>
          <p className="mt-1 min-h-10 text-sm text-zinc-500">{list.description || "No description"}</p>
          <div className="mt-5 flex items-center gap-2 border-t border-zinc-100 pt-4 text-sm font-bold text-zinc-500 dark:border-zinc-800">
            <UsersRound className="h-4 w-4"/>{list.isDynamic ? "Computed at send time" : `${(counts.get(list.id)||0).toLocaleString()} members`}
          </div>
          <div className="mt-4 border-t border-[var(--border)] pt-4">
            <AudienceActions audience={{id:list.id,name:list.name,description:list.description,isDynamic:list.isDynamic}} compact />
          </div>
        </article>
      ) : <div className="premium-panel col-span-full grid min-h-72 place-items-center text-center"><div><Layers3 className="mx-auto h-8 w-8 text-zinc-400"/><h2 className="mt-4 font-black">No audiences yet</h2></div></div>}
    </section>
  </AppShell>;
}