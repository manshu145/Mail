import { ArrowLeft, CircleGauge, MailCheck, MousePointerClick, Users } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { CampaignControl } from "@/components/campaign-control";
import { CampaignEditor } from "@/components/campaign-editor";
import { MessageStatusBadge } from "@/components/message-status-badge";
import { db, databaseConfigured } from "@/db";
import { campaignPreflights } from "@/db/campaign-ops-schema";
import { campaigns, lists, sendingAccounts, templates } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getRuntimePolicy } from "@/lib/runtime-policy";
import { getCampaignMetrics } from "@/lib/campaign-reporting";

const fmt=(value:Date|string|null|undefined)=>value?new Intl.DateTimeFormat("en",{dateStyle:"short",timeStyle:"short"}).format(new Date(value)):"—";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!databaseConfigured) notFound();

  const { id } = await params;
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!campaign) notFound();

  const [listRows, templateRows, accountRows, metrics, recipientResult, linkResult, preflightRows] = await Promise.all([
    db.select({ id: lists.id, name: lists.name }).from(lists),
    db.select({ id: templates.id, name: templates.name }).from(templates),
    db.select({ id: sendingAccounts.id, name: sendingAccounts.name, fromName: sendingAccounts.fromName, fromEmail: sendingAccounts.fromEmail, replyTo: sendingAccounts.replyTo }).from(sendingAccounts).where(eq(sendingAccounts.status, "active")),
    getCampaignMetrics(id),
    db.execute(sql`
      select m.id::text,m.recipient_email,m.status::text,m.provider_message_id,m.accepted_at,m.delivered_at,m.bounced_at,m.last_error,
        count(e.id) filter(where e.type='open' and coalesce((e.payload->>'automated')::boolean,false)=false)::int opens,
        count(e.id) filter(where e.type='click' and coalesce((e.payload->>'automated')::boolean,false)=false)::int clicks,
        max(e.created_at) filter(where e.type in ('open','click') and coalesce((e.payload->>'automated')::boolean,false)=false) last_activity
      from messages m
      left join message_events e on e.message_id=m.id
      where m.campaign_id=${id}
      group by m.id
      order by m.queued_at desc
      limit 100
    `),
    db.execute(sql`
      select e.payload->>'url' url,
        count(*) filter(where coalesce((e.payload->>'automated')::boolean,false)=false)::int clicks,
        count(distinct e.message_id) filter(where coalesce((e.payload->>'automated')::boolean,false)=false)::int unique_clickers
      from message_events e
      join messages m on m.id=e.message_id
      where m.campaign_id=${id} and e.type='click' and e.payload->>'url' is not null
      group by e.payload->>'url'
      having count(*) filter(where coalesce((e.payload->>'automated')::boolean,false)=false) > 0
      order by clicks desc
      limit 20
    `),
    db.select().from(campaignPreflights).where(eq(campaignPreflights.campaignId,id)).limit(1),
  ]);

  const recipientRows=recipientResult.rows as Array<Record<string,unknown>>;
  const links=linkResult.rows as Array<Record<string,unknown>>;
  const preflight=preflightRows[0]||null;
  const editable = ["draft", "paused", "scheduled"].includes(campaign.status);
  const runtimePolicy = getRuntimePolicy();
  const cards = metrics ? [
    ["Targeted",metrics.targeted,Users],["Delivered",metrics.delivered,MailCheck],["Verified opens",metrics.uniqueOpens,MailCheck],["Verified clicks",metrics.uniqueClicks,MousePointerClick]
  ] as const : [];
  const inFlight=metrics?metrics.queued+metrics.ready+metrics.sending+metrics.accepted+metrics.deferred:0;

  return <AppShell session={session}>
    <div className="mb-7">
      <Link className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[var(--muted)] hover:text-[var(--foreground)]" href="/campaigns"><ArrowLeft className="h-4 w-4" />Campaigns</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="page-eyebrow">Campaign report</p><h1 className="mt-2 text-3xl font-black tracking-[-.035em] sm:text-4xl">{campaign.name}</h1><p className="mt-2 text-sm text-[var(--muted)]">{campaign.subject}</p></div>
        <div className="flex flex-wrap items-center justify-end gap-2"><span className="rounded-full bg-violet-500/10 px-3 py-1.5 text-xs font-extrabold capitalize text-violet-700 dark:text-violet-300">{campaign.status}</span><CampaignControl id={campaign.id} status={campaign.status} failed={metrics?.failed||0} /></div>
      </div>
    </div>

    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[['Created',fmt(campaign.createdAt)],['Started',fmt(campaign.startedAt)],['Completed',fmt(campaign.completedAt)],['Scheduled',fmt(campaign.scheduledAt)]].map(([label,value])=><article key={label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1.5 text-sm font-black">{value}</p></article>)}
    </section>

    {campaign.lastError?<div className="mb-5 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3 text-sm font-semibold text-rose-600">{campaign.lastError}</div>:null}

    {preflight ? <section className="premium-panel mb-5 overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Audience preflight</h2><p className="mt-1 text-xs text-[var(--muted)]">Eligibility is snapshotted before delivery. Only active contacts with confirmed consent and a recorded source are considered. Suppressed and invalid contacts are excluded.</p></div><div className="grid gap-px bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-7">{[["Active opt-ins",preflight.rawCount],["Eligible",preflight.eligibleCount],["Suppressed",preflight.suppressedCount],["Invalid",preflight.invalidCount],["Valid",preflight.validCount],["Pending",preflight.pendingCount],["Unknown",preflight.unknownCount]].map(([label,value])=><div className="bg-[var(--surface)] p-4" key={String(label)}><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1 text-2xl font-black">{Number(value).toLocaleString()}</p></div>)}</div><div className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--muted)]">Last checked {fmt(preflight.checkedAt)}</div></section> : null}

    {metrics && metrics.targeted>0 ? <>
      <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,count,Icon])=><article className="premium-panel p-5" key={label}><div className="flex items-start justify-between"><div><p className="text-sm font-bold text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-black">{Number(count).toLocaleString()}</p></div><Icon className="h-5 w-5 text-[var(--muted)]"/></div></article>)}</section>
      <section className="mb-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">{[["Delivery",metrics.deliveryRate],["Open rate",metrics.openRate],["Click rate",metrics.clickRate],["CTOR",metrics.ctor],["Bounce",metrics.bounceRate],["Unsubscribes",metrics.unsubscribes]].map(([label,value])=><article key={String(label)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1.5 text-xl font-black">{label==="Unsubscribes"?Number(value).toLocaleString():`${Number(value).toFixed(2)}%`}</p></article>)}</section>
      <section className="mb-5 grid gap-5 xl:grid-cols-2">
        <article className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Delivery funnel</h2><p className="mt-1 text-xs text-[var(--muted)]">Recipient state stays separated from local MTA acceptance.</p></div><div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">{[["Targeted",metrics.targeted],["Delivered",metrics.delivered],["In flight",inFlight],["Bounced",metrics.bounced],["Failed",metrics.failed],["Cancelled",metrics.cancelled]].map(([label,value])=><div key={String(label)} className="bg-[var(--surface)] p-4"><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1 text-2xl font-black">{Number(value).toLocaleString()}</p></div>)}</div></article>
        <article className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Engagement quality</h2><p className="mt-1 text-xs text-[var(--muted)]">Human-like activity is separated from known automated scanners and previews.</p></div><div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">{[["Unique opens",metrics.uniqueOpens],["Total opens",metrics.totalOpens],["Unique clickers",metrics.uniqueClicks],["Total clicks",metrics.totalClicks],["Automated opens",metrics.automatedOpens],["Automated clicks",metrics.automatedClicks]].map(([label,value])=><div key={String(label)} className="bg-[var(--surface)] p-4"><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1 text-2xl font-black">{Number(value).toLocaleString()}</p></div>)}</div></article>
      </section>
    </> : null}

    {editable ? <section className="premium-panel p-6"><CampaignEditor campaign={{ ...campaign, scheduledAt: campaign.scheduledAt?.toISOString() || null }} lists={listRows} templates={templateRows} accounts={accountRows} runtimePolicy={{ mode: runtimePolicy.mode, sendingEnabled: runtimePolicy.sendingEnabled, maxRecipientsPerCampaign: runtimePolicy.maxRecipientsPerCampaign }} /></section> : <section className="premium-panel p-6"><div className="grid min-h-32 place-items-center text-center"><div><CircleGauge className="mx-auto h-8 w-8 text-[var(--muted)]" /><h2 className="mt-4 font-black">Delivery processing</h2><p className="mt-1 text-sm text-[var(--muted)]">Editing is locked after the audience snapshot begins.</p></div></div></section>}

    {links.length?<section className="premium-panel mt-5 overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Clicked links</h2><p className="mt-1 text-xs text-[var(--muted)]">Verified click activity with automated requests excluded.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">URL</th><th>Unique clickers</th><th>Total clicks</th></tr></thead><tbody>{links.map((row,i)=><tr className="border-t border-[var(--border)]" key={`${String(row.url)}-${i}`}><td className="max-w-[620px] truncate px-5 py-3.5"><a className="font-semibold hover:underline" href={String(row.url)} target="_blank" rel="noreferrer">{String(row.url)}</a></td><td>{Number(row.unique_clickers||0).toLocaleString()}</td><td>{Number(row.clicks||0).toLocaleString()}</td></tr>)}</tbody></table></div></section>:null}

    {recipientRows.length ? <section className="premium-panel mt-5 overflow-hidden"><div className="border-b border-[var(--border)] px-4 py-3.5 sm:px-5"><h2 className="font-black">Recipient delivery log</h2><p className="mt-0.5 text-[11px] text-[var(--muted)]">Latest 100 recipient records with verified engagement.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-4 py-2.5 sm:px-5">Recipient</th><th>Status</th><th>Opens</th><th>Clicks</th><th>Accepted</th><th>Delivered</th><th>Last activity</th><th className="pr-4 sm:pr-5">Error</th></tr></thead><tbody>{recipientRows.map((m)=><tr className="border-t border-[var(--border)] transition hover:bg-[var(--surface-soft)]" key={String(m.id)}><td className="px-4 py-2.5 font-bold sm:px-5">{String(m.recipient_email)}</td><td className="py-2.5"><MessageStatusBadge status={String(m.status)} compact /></td><td className="py-2.5">{Number(m.opens||0).toLocaleString()}</td><td className="py-2.5">{Number(m.clicks||0).toLocaleString()}</td><td className="py-2.5 text-[11px] text-[var(--muted)]">{fmt(m.accepted_at as string|null)}</td><td className="py-2.5 text-[11px] text-[var(--muted)]">{fmt(m.delivered_at as string|null)}</td><td className="py-2.5 text-[11px] text-[var(--muted)]">{fmt(m.last_activity as string|null)}</td><td className="max-w-[240px] truncate py-2.5 pr-4 text-[11px] text-rose-500 sm:pr-5" title={String(m.last_error||"")}>{String(m.last_error||"—")}</td></tr>)}</tbody></table></div></section> : null}
  </AppShell>;
}
