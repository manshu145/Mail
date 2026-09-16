import { desc, eq, sql } from "drizzle-orm";
import { Blocks, Layers3, Tags, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SegmentCreate } from "@/components/segment-create";
import { db, databaseConfigured } from "@/db";
import { contactLists, contactTags, lists, tags } from "@/db/schema";
import { segmentDefinitions } from "@/db/segment-schema";
import { getSession } from "@/lib/auth";

export default async function SegmentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let listRows: Array<{ id: string; name: string; description: string | null; isDynamic: boolean; members: number }> = [];
  let tagRows: Array<{ id: string; name: string; members: number }> = [];
  let segments: Array<{ id: string; name: string; description: string | null; field: string; operator: string; value: string }> = [];
  let dbError = false;

  if (databaseConfigured) {
    try {
      const [rawLists, rawTags, segmentRows] = await Promise.all([
        db.select({ id: lists.id, name: lists.name, description: lists.description, isDynamic: lists.isDynamic, members: sql<number>`count(${contactLists.contactId})::int` }).from(lists).leftJoin(contactLists, eq(contactLists.listId, lists.id)).groupBy(lists.id).orderBy(desc(lists.updatedAt)).limit(50),
        db.select({ id: tags.id, name: tags.name, members: sql<number>`count(${contactTags.contactId})::int` }).from(tags).leftJoin(contactTags, eq(contactTags.tagId, tags.id)).groupBy(tags.id).orderBy(sql`count(${contactTags.contactId}) desc`).limit(50),
        db.select({ id: lists.id, name: lists.name, description: lists.description, field: segmentDefinitions.field, operator: segmentDefinitions.operator, value: segmentDefinitions.value }).from(segmentDefinitions).innerJoin(lists, eq(lists.id, segmentDefinitions.listId)).orderBy(desc(segmentDefinitions.updatedAt)),
      ]);
      listRows = rawLists;
      tagRows = rawTags;
      segments = segmentRows;
    } catch { dbError = true; }
  }
  const usable = databaseConfigured && !dbError;
  const totalAssignments = tagRows.reduce((sum, row) => sum + row.members, 0);

  return <AppShell session={session}>
    <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="page-eyebrow mb-2">Audience intelligence</p><h1 className="page-title">Segments</h1><p className="page-description">Build reusable dynamic audiences that resolve again when a campaign starts.</p></div><SegmentCreate disabled={!usable} /></div>
    {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Audience data unavailable.</b> The isolated database must be connected first.</div> : null}
    <section className="mb-5 grid gap-3 sm:grid-cols-3">{[{label:"Segments",value:segments.length,icon:Blocks},{label:"Lists",value:listRows.length,icon:Layers3},{label:"Tag assignments",value:totalAssignments,icon:UsersRound}].map(({label,value,icon:Icon}) => <article key={label} className="metric-card p-5"><div className="flex items-start justify-between"><div><p className="text-[12px] font-extrabold text-[var(--muted)]">{label}</p><p className="mt-3 text-3xl font-black tracking-[-0.04em]">{value.toLocaleString()}</p></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Icon className="h-4.5 w-4.5" /></div></div></article>)}</section>
    <section className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <article className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] px-5 py-4 sm:px-6"><p className="text-[10px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Dynamic targeting</p><h2 className="mt-1 text-lg font-black">Saved segments</h2></div>{segments.length ? <div className="divide-y divide-[var(--border)]">{segments.map((row) => <div key={row.id} className="px-5 py-4 sm:px-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-extrabold">{row.name}</p><p className="mt-1 text-xs text-[var(--muted)]">{row.description || "Dynamic audience"}</p></div><code className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1.5 text-[11px] font-bold">{row.field} {row.operator.replace("_", " ")} {row.value}</code></div></div>)}</div> : <div className="grid min-h-56 place-items-center p-8 text-center"><div><Blocks className="mx-auto h-7 w-7 text-[var(--muted)]"/><p className="mt-3 font-black">No dynamic segments yet</p></div></div>}</article>
      <article className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] px-5 py-4 sm:px-6"><p className="text-[10px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Targeting taxonomy</p><h2 className="mt-1 text-lg font-black">Tags</h2></div>{tagRows.length ? <div className="p-5 sm:p-6"><div className="flex flex-wrap gap-2">{tagRows.map((row) => <span key={row.id} className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-bold"><span>{row.name}</span><span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-black text-violet-700 dark:text-violet-300">{row.members}</span></span>)}</div></div> : <div className="grid min-h-56 place-items-center p-8 text-center"><div><Tags className="mx-auto h-7 w-7 text-[var(--muted)]"/><p className="mt-3 font-black">No tags yet</p></div></div>}</article>
    </section>
  </AppShell>;
}
