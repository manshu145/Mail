import { desc, eq, sql } from "drizzle-orm";
import { Blocks, Layers3, MousePointerClick, Tags, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { EngagementSegmentCreate } from "@/components/engagement-segment-create";
import { SegmentCreate } from "@/components/segment-create";
import { db, databaseConfigured } from "@/db";
import { campaigns, contactLists, contactTags, lists, tags } from "@/db/schema";
import { engagementSegmentDefinitions, segmentDefinitions } from "@/db/segment-schema";
import { getSession } from "@/lib/auth";

export default async function SegmentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let listRows: Array<{ id: string; name: string; description: string | null; isDynamic: boolean; members: number }> = [];
  let tagRows: Array<{ id: string; name: string; members: number }> = [];
  let segments: Array<{ id: string; name: string; description: string | null; field: string; attributeKey: string | null; operator: string; value: string }> = [];
  let engagementSegments: Array<{ id: string; name: string; description: string | null; campaignName: string; ruleType: string; windowDays: number | null }> = [];
  let campaignRows: Array<{ id: string; name: string }> = [];
  let dbError = false;

  if (databaseConfigured) {
    try {
      const [rawLists, rawTags, segmentRows, engagementRows, rawCampaigns] = await Promise.all([
        db.select({ id: lists.id, name: lists.name, description: lists.description, isDynamic: lists.isDynamic, members: sql<number>`count(${contactLists.contactId})::int` }).from(lists).leftJoin(contactLists, eq(contactLists.listId, lists.id)).groupBy(lists.id).orderBy(desc(lists.updatedAt)).limit(100),
        db.select({ id: tags.id, name: tags.name, members: sql<number>`count(${contactTags.contactId})::int` }).from(tags).leftJoin(contactTags, eq(contactTags.tagId, tags.id)).groupBy(tags.id).orderBy(sql`count(${contactTags.contactId}) desc`).limit(50),
        db.select({ id: lists.id, name: lists.name, description: lists.description, field: segmentDefinitions.field, attributeKey: segmentDefinitions.attributeKey, operator: segmentDefinitions.operator, value: segmentDefinitions.value }).from(segmentDefinitions).innerJoin(lists, eq(lists.id, segmentDefinitions.listId)).orderBy(desc(segmentDefinitions.updatedAt)),
        db.select({ id: lists.id, name: lists.name, description: lists.description, campaignName: campaigns.name, ruleType: engagementSegmentDefinitions.ruleType, windowDays: engagementSegmentDefinitions.windowDays }).from(engagementSegmentDefinitions).innerJoin(lists, eq(lists.id, engagementSegmentDefinitions.listId)).innerJoin(campaigns, eq(campaigns.id, engagementSegmentDefinitions.campaignId)).orderBy(desc(engagementSegmentDefinitions.updatedAt)),
        db.select({ id: campaigns.id, name: campaigns.name }).from(campaigns).orderBy(desc(campaigns.createdAt)).limit(100),
      ]);
      listRows = rawLists; tagRows = rawTags; segments = segmentRows; engagementSegments = engagementRows; campaignRows = rawCampaigns;
    } catch (error) { console.error("[segments]", error); dbError = true; }
  }
  const usable = databaseConfigured && !dbError;
  const totalAssignments = tagRows.reduce((sum, row) => sum + row.members, 0);

  return <AppShell session={session}>
    <div className="page-intro"><div><p className="page-eyebrow mb-2">Audience intelligence</p><h1 className="page-title">Segments</h1><p className="page-description">Build reusable audiences from contact data, imported custom fields or real campaign engagement.</p></div><div className="flex flex-wrap gap-2"><EngagementSegmentCreate campaigns={campaignRows} disabled={!usable}/><SegmentCreate disabled={!usable}/></div></div>
    {!usable ? <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200"><b>Audience data unavailable.</b> Check the database connection.</div> : null}
    <section className="mb-4 grid gap-2 sm:grid-cols-4">{[{label:"Rule segments",value:segments.length,icon:Blocks},{label:"Engagement segments",value:engagementSegments.length,icon:MousePointerClick},{label:"Lists",value:listRows.length,icon:Layers3},{label:"Tag assignments",value:totalAssignments,icon:UsersRound}].map(({label,value,icon:Icon}) => <article key={label} className="metric-card surface-lift p-4"><div className="flex items-start justify-between"><div><p className="compact-stat-label">{label}</p><p className="compact-stat-value">{value.toLocaleString()}</p></div><div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-500/[0.08] text-violet-700 dark:text-violet-300"><Icon className="h-4.5 w-4.5" /></div></div></article>)}</section>

    <section className="section-card mb-4 overflow-hidden"><div className="border-b border-[var(--border)] px-4 py-3.5"><p className="text-[11px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Campaign behavior</p><h2 className="mt-1 text-lg font-black">Engagement audiences</h2><p className="mt-1 text-xs text-[var(--muted)]">Automated opens/clicks are excluded. Dynamic audiences resolve again when a campaign starts.</p></div>{engagementSegments.length ? <div className="divide-y divide-[var(--border)]">{engagementSegments.map(row => <div key={row.id} className="interactive-row flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><p className="text-sm font-extrabold">{row.name}</p><p className="mt-1 text-xs text-[var(--muted)]">{row.description || row.campaignName}</p></div><div className="text-right"><p className="text-xs font-black">{row.ruleType.replaceAll("_", " ")}</p><p className="mt-1 text-[11px] text-[var(--muted)]">{row.campaignName}{row.windowDays ? ` · last ${row.windowDays}d` : " · full campaign"}</p></div></div>)}</div> : <div className="p-8 text-center text-sm text-[var(--muted)]">No engagement audiences yet.</div>}</section>

    <section className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
      <article className="section-card overflow-hidden"><div className="border-b border-[var(--border)] px-5 py-4 sm:px-6"><p className="text-[11px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Dynamic targeting</p><h2 className="mt-1 text-lg font-black">Contact-rule segments</h2></div>{segments.length ? <div className="divide-y divide-[var(--border)]">{segments.map((row) => <div key={row.id} className="px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-extrabold">{row.name}</p><p className="mt-1 text-xs text-[var(--muted)]">{row.description || "Dynamic audience"}</p></div><code className="rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-1.5 text-[11px] font-bold">{row.field === "custom_attribute" ? `custom.${row.attributeKey || "?"}` : row.field} {row.operator.replace("_", " ")} {row.value}</code></div></div>)}</div> : <div className="p-8 text-center text-sm text-[var(--muted)]">No contact-rule segments yet.</div>}</article>
      <article className="section-card overflow-hidden"><div className="border-b border-[var(--border)] px-5 py-4 sm:px-6"><p className="text-[11px] font-black uppercase tracking-[.16em] text-[var(--muted)]">Targeting taxonomy</p><h2 className="mt-1 text-lg font-black">Tags</h2></div>{tagRows.length ? <div className="p-4"><div className="flex flex-wrap gap-2">{tagRows.map((row) => <span key={row.id} className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-xs font-bold"><span>{row.name}</span><span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-black text-violet-700 dark:text-violet-300">{row.members}</span></span>)}</div></div> : <div className="p-8 text-center text-sm text-[var(--muted)]">No tags yet.</div>}</article>
    </section>
  </AppShell>;
}
