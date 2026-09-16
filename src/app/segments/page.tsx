import { desc, eq, sql } from "drizzle-orm";
import { Blocks, Layers3, Tags, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { db, databaseConfigured } from "@/db";
import { contactLists, contactTags, lists, tags } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function SegmentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let listRows: Array<{ id: string; name: string; description: string | null; isDynamic: boolean; members: number }> = [];
  let tagRows: Array<{ id: string; name: string; members: number }> = [];
  let dbError = false;

  if (databaseConfigured) {
    try {
      const [rawLists, rawTags] = await Promise.all([
        db.select({ id: lists.id, name: lists.name, description: lists.description, isDynamic: lists.isDynamic, members: sql<number>`count(${contactLists.contactId})::int` })
          .from(lists).leftJoin(contactLists, eq(contactLists.listId, lists.id)).groupBy(lists.id).orderBy(desc(lists.updatedAt)).limit(50),
        db.select({ id: tags.id, name: tags.name, members: sql<number>`count(${contactTags.contactId})::int` })
          .from(tags).leftJoin(contactTags, eq(contactTags.tagId, tags.id)).groupBy(tags.id).orderBy(sql`count(${contactTags.contactId}) desc`).limit(50),
      ]);
      listRows = rawLists;
      tagRows = rawTags;
    } catch { dbError = true; }
  }
  const usable = databaseConfigured && !dbError;
  const totalAssignments = tagRows.reduce((sum, row) => sum + row.members, 0);

  return (
    <AppShell session={session}>
      <div className="mb-7">
        <p className="page-eyebrow mb-2">Audience intelligence</p>
        <h1 className="page-title">Segments</h1>
        <p className="page-description">Organize audiences using lists and tags today, with the advanced nested AND/OR segment engine mapped from the VPS source for the production integration phase.</p>
      </div>

      {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Audience data is unavailable in this preview.</b> Connect PostgreSQL to inspect live list and tag membership.</div> : null}

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        {[{label:"Lists",value:listRows.length,icon:Layers3},{label:"Tags",value:tagRows.length,icon:Tags},{label:"Tag assignments",value:totalAssignments,icon:UsersRound}].map(({label,value,icon:Icon}) => <article key={label} className="metric-card p-5"><div className="flex items-start justify-between"><div><p className="text-[12px] font-extrabold text-[var(--muted)]">{label}</p><p className="mt-3 text-3xl font-black tracking-[-0.04em]">{value.toLocaleString()}</p></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Icon className="h-4.5 w-4.5" /></div></div></article>)}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <article className="premium-panel overflow-hidden">
          <div className="border-b border-[var(--border)] px-5 py-4 sm:px-6"><p className="text-[10px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Audience building blocks</p><h2 className="mt-1 text-lg font-black">Lists</h2></div>
          {listRows.length ? <div className="divide-y divide-[var(--border)]">{listRows.map((row) => <a key={row.id} href={`/lists/${row.id}`} className="flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-[var(--surface-soft)] sm:px-6"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate text-sm font-extrabold">{row.name}</p>{row.isDynamic ? <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-black text-violet-700 dark:text-violet-300">Dynamic</span> : null}</div><p className="mt-1 truncate text-xs text-[var(--muted)]">{row.description || "Static audience list"}</p></div><span className="shrink-0 text-sm font-black">{row.members.toLocaleString()}</span></a>)}</div> : <div className="grid min-h-56 place-items-center p-8 text-center"><div><Layers3 className="mx-auto h-7 w-7 text-[var(--muted)]" /><p className="mt-3 font-black">No lists yet</p></div></div>}
        </article>

        <article className="premium-panel overflow-hidden">
          <div className="border-b border-[var(--border)] px-5 py-4 sm:px-6"><p className="text-[10px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Targeting taxonomy</p><h2 className="mt-1 text-lg font-black">Tags</h2></div>
          {tagRows.length ? <div className="p-5 sm:p-6"><div className="flex flex-wrap gap-2">{tagRows.map((row) => <span key={row.id} className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-bold"><span>{row.name}</span><span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-black text-violet-700 dark:text-violet-300">{row.members}</span></span>)}</div></div> : <div className="grid min-h-56 place-items-center p-8 text-center"><div><Tags className="mx-auto h-7 w-7 text-[var(--muted)]" /><p className="mt-3 font-black">No tags yet</p></div></div>}
        </article>
      </section>

      <section className="mt-5 rounded-2xl border border-violet-500/15 bg-violet-500/[0.045] p-5 sm:p-6">
        <div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><Blocks className="h-5 w-5" /></div><div><h2 className="font-black">Advanced segment engine mapped from the VPS build</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted)]">The VPS source supports reusable nested AND/OR targeting across tags, geography, category and engagement. I am keeping that logic out of the preview database until schema parity is added, instead of inventing a second incompatible segment model.</p></div></div>
      </section>
    </AppShell>
  );
}
