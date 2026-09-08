import { ArrowLeft, CircleGauge } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { CampaignEditor } from "@/components/campaign-editor";
import { db, databaseConfigured } from "@/db";
import { campaigns, lists, messages, sendingAccounts, templates } from "@/db/schema";
import { getSession } from "@/lib/auth";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session) redirect("/login");
  if (!databaseConfigured) notFound();
  const { id } = await params;
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!campaign) notFound();
  const [listRows, templateRows, accountRows, stateRows] = await Promise.all([
    db.select({ id: lists.id, name: lists.name }).from(lists),
    db.select({ id: templates.id, name: templates.name }).from(templates),
    db.select({ id: sendingAccounts.id, name: sendingAccounts.name }).from(sendingAccounts).where(eq(sendingAccounts.status,"active")),
    db.select({ status: messages.status, value: sql<number>`count(*)::int` }).from(messages).where(eq(messages.campaignId,id)).groupBy(messages.status),
  ]);
  const state = Object.fromEntries(stateRows.map((row)=>[row.status,row.value]));
  const editable=["draft","paused","scheduled"].includes(campaign.status);
  return <AppShell session={session}><div className="mb-7"><Link className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white" href="/campaigns"><ArrowLeft className="h-4 w-4"/>Campaigns</Link><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-extrabold uppercase tracking-[.18em] text-zinc-400">Campaign builder</p><h1 className="mt-2 text-3xl font-black tracking-[-.035em] sm:text-4xl">{campaign.name}</h1></div><span className="self-start rounded-full bg-violet-50 px-3 py-1.5 text-xs font-extrabold capitalize text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">{campaign.status}</span></div></div><section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Queued",state.queued||0],["Ready",state.ready_for_transport||0],["MTA accepted",state.mta_accepted||0],["Delivered",state.delivered||0]].map(([label,value])=><article className="premium-panel p-5" key={String(label)}><p className="text-sm font-bold text-zinc-500">{label}</p><p className="mt-2 text-3xl font-black tracking-[-.04em]">{Number(value).toLocaleString()}</p></article>)}</section><section className="premium-panel p-6">{editable?<CampaignEditor campaign={{...campaign,scheduledAt:campaign.scheduledAt?.toISOString()||null}} lists={listRows} templates={templateRows} accounts={accountRows}/>:<div className="grid min-h-52 place-items-center text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-zinc-100 text-zinc-500 dark:bg-zinc-900"><CircleGauge className="h-5 w-5"/></div><h2 className="mt-4 font-black">Campaign is in the sending pipeline</h2><p className="mt-1 text-sm text-zinc-500">Editing is locked once worker processing begins.</p></div></div>}</section></AppShell>;
}
