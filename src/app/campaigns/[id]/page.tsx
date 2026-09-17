import { ArrowLeft, CircleGauge, MailCheck, MousePointerClick, Users } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { CampaignControl } from "@/components/campaign-control";
import { CampaignEditor } from "@/components/campaign-editor";
import { db, databaseConfigured } from "@/db";
import { campaigns, lists, messages, sendingAccounts, templates } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getRuntimePolicy } from "@/lib/runtime-policy";
import { getCampaignMetrics } from "@/lib/campaign-reporting";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!databaseConfigured) notFound();

  const { id } = await params;
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!campaign) notFound();

  const [listRows, templateRows, accountRows, metrics, recent] = await Promise.all([
    db.select({ id: lists.id, name: lists.name }).from(lists),
    db.select({ id: templates.id, name: templates.name }).from(templates),
    db.select({ id: sendingAccounts.id, name: sendingAccounts.name, fromName: sendingAccounts.fromName, fromEmail: sendingAccounts.fromEmail, replyTo: sendingAccounts.replyTo }).from(sendingAccounts).where(eq(sendingAccounts.status, "active")),
    getCampaignMetrics(id),
    db.select().from(messages).where(eq(messages.campaignId,id)).orderBy(messages.queuedAt).limit(20),
  ]);

  const editable = ["draft", "paused", "scheduled"].includes(campaign.status);
  const runtimePolicy = getRuntimePolicy();
  const cards = metrics ? [
    ["Targeted",metrics.targeted,Users],["Delivered",metrics.delivered,MailCheck],["Unique opens",metrics.uniqueOpens,MailCheck],["Unique clicks",metrics.uniqueClicks,MousePointerClick]
  ] as const : [];

  return <AppShell session={session}>
    <div className="mb-7">
      <Link className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[var(--muted)] hover:text-[var(--foreground)]" href="/campaigns"><ArrowLeft className="h-4 w-4" />Campaigns</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="page-eyebrow">Campaign</p><h1 className="mt-2 text-3xl font-black tracking-[-.035em] sm:text-4xl">{campaign.name}</h1><p className="mt-2 text-sm text-[var(--muted)]">Recipient-level delivery and engagement are calculated from persisted transport and tracking events.</p></div>
        <div className="flex items-center gap-2"><span className="rounded-full bg-violet-500/10 px-3 py-1.5 text-xs font-extrabold capitalize text-violet-700 dark:text-violet-300">{campaign.status}</span><CampaignControl id={campaign.id} status={campaign.status} /></div>
      </div>
    </div>

    {metrics && metrics.targeted>0 ? <>
      <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,count,Icon])=><article className="premium-panel p-5" key={label}><div className="flex items-start justify-between"><div><p className="text-sm font-bold text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-black">{Number(count).toLocaleString()}</p></div><Icon className="h-5 w-5 text-[var(--muted)]"/></div></article>)}</section>
      <section className="mb-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">{[["Delivery",metrics.deliveryRate],["Open rate",metrics.openRate],["Click rate",metrics.clickRate],["CTOR",metrics.ctor],["Bounce",metrics.bounceRate],["Unsubscribes",metrics.unsubscribes]].map(([label,value])=><article key={String(label)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1.5 text-xl font-black">{label==="Unsubscribes"?Number(value).toLocaleString():`${Number(value).toFixed(2)}%`}</p></article>)}</section>
      <section className="premium-panel mb-5 overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Delivery pipeline</h2><p className="mt-1 text-xs text-[var(--muted)]">Local acceptance, remote acceptance and terminal failures remain separate.</p></div><div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-5">{[["Queued",metrics.queued],["Ready",metrics.ready],["MTA accepted",metrics.accepted],["Deferred",metrics.deferred],["Failed / bounced",metrics.failed+metrics.bounced]].map(([label,value])=><div key={String(label)} className="bg-[var(--surface)] p-4"><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1 text-2xl font-black">{Number(value).toLocaleString()}</p></div>)}</div></section>
    </> : null}

    <section className="premium-panel p-6">{editable ? <CampaignEditor campaign={{ ...campaign, scheduledAt: campaign.scheduledAt?.toISOString() || null }} lists={listRows} templates={templateRows} accounts={accountRows} runtimePolicy={{ mode: runtimePolicy.mode, sendingEnabled: runtimePolicy.sendingEnabled, maxRecipientsPerCampaign: runtimePolicy.maxRecipientsPerCampaign }} /> : <div className="grid min-h-44 place-items-center text-center"><div><CircleGauge className="mx-auto h-8 w-8 text-[var(--muted)]" /><h2 className="mt-4 font-black">Campaign processing</h2><p className="mt-1 text-sm text-[var(--muted)]">Editing is locked after recipient processing begins. Delivery continues through the worker pipeline.</p></div></div>}</section>

    {recent.length ? <section className="premium-panel mt-5 overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Recent recipients</h2><p className="mt-1 text-xs text-[var(--muted)]">Latest persisted recipient states for this campaign.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">Recipient</th><th>Status</th><th>Provider ID</th><th>Accepted</th><th>Delivered</th><th>Error</th></tr></thead><tbody>{recent.map((m)=><tr className="border-t border-[var(--border)]" key={m.id}><td className="px-5 py-3.5 font-bold">{m.recipientEmail}</td><td className="capitalize">{m.status.replaceAll("_"," ")}</td><td className="font-mono text-xs text-[var(--muted)]">{m.providerMessageId||"—"}</td><td className="text-xs text-[var(--muted)]">{m.acceptedAt?new Intl.DateTimeFormat("en",{dateStyle:"short",timeStyle:"short"}).format(m.acceptedAt):"—"}</td><td className="text-xs text-[var(--muted)]">{m.deliveredAt?new Intl.DateTimeFormat("en",{dateStyle:"short",timeStyle:"short"}).format(m.deliveredAt):"—"}</td><td className="max-w-[220px] truncate text-xs text-rose-500">{m.lastError||"—"}</td></tr>)}</tbody></table></div></section> : null}
  </AppShell>;
}
