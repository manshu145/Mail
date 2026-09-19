import Link from "next/link";
import { ArrowLeft, MousePointerClick, Eye, Clock3 } from "lucide-react";
import { redirect, notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { db, databaseConfigured } from "@/db";
import { campaigns, contacts, messageEvents, messages } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { providerForEmail, providerLabel } from "@/lib/provider";

const fmt = (value: Date | null | undefined) => value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" }).format(value) : "—";

export default async function MessageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!databaseConfigured) redirect("/messages");
  const { id } = await params;

  const [row] = await db.select({
    message: messages,
    campaignName: campaigns.name,
    campaignSubject: campaigns.subject,
    contactFirstName: contacts.firstName,
    contactLastName: contacts.lastName,
    contactEmail: contacts.email,
    contactValidation: contacts.validationStatus,
  }).from(messages)
    .innerJoin(campaigns, eq(campaigns.id, messages.campaignId))
    .innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(eq(messages.id, id)).limit(1);
  if (!row) notFound();

  const events = await db.select().from(messageEvents).where(eq(messageEvents.messageId, id)).orderBy(desc(messageEvents.createdAt)).limit(250);
  const stats = await db.execute(sql`select
    count(*) filter(where type='open' and coalesce((payload->>'automated')::boolean,false)=false)::int human_opens,
    count(*) filter(where type='click' and coalesce((payload->>'automated')::boolean,false)=false)::int human_clicks,
    count(*) filter(where type='open' and coalesce((payload->>'automated')::boolean,false)=true)::int automated_opens,
    count(*) filter(where type='click' and coalesce((payload->>'automated')::boolean,false)=true)::int automated_clicks,
    min(created_at) filter(where type='open' and coalesce((payload->>'automated')::boolean,false)=false) first_open,
    max(created_at) filter(where type='open' and coalesce((payload->>'automated')::boolean,false)=false) last_open,
    min(created_at) filter(where type='click' and coalesce((payload->>'automated')::boolean,false)=false) first_click,
    max(created_at) filter(where type='click' and coalesce((payload->>'automated')::boolean,false)=false) last_click
    from message_events where message_id=${id}`);
  const s = (stats.rows[0] || {}) as Record<string, unknown>;
  const m = row.message;
  const displayName = [row.contactFirstName, row.contactLastName].filter(Boolean).join(" ") || row.contactEmail;
  const provider = providerForEmail(m.recipientEmail);

  return <AppShell session={session}>
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><Link href="/messages" className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-[var(--muted)] hover:text-[var(--text)]"><ArrowLeft className="h-4 w-4"/>Message log</Link><p className="page-eyebrow mb-2">Recipient activity</p><h1 className="page-title">{displayName}</h1><p className="page-description">{m.recipientEmail} · {providerLabel(provider)} · campaign <Link className="font-bold hover:underline" href={`/campaigns/${m.campaignId}`}>{row.campaignName}</Link></p></div>
      <span className={`rounded-full px-3 py-1.5 text-xs font-black capitalize ${m.status==="delivered"?"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300":["bounced","failed"].includes(m.status)?"bg-rose-500/10 text-rose-700 dark:text-rose-300":"bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>{m.status.replaceAll("_"," ")}</span>
    </div>

    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[{l:"Human opens",v:Number(s.human_opens||0),icon:Eye},{l:"Human clicks",v:Number(s.human_clicks||0),icon:MousePointerClick},{l:"Automated opens",v:Number(s.automated_opens||0),icon:Eye},{l:"Automated clicks",v:Number(s.automated_clicks||0),icon:MousePointerClick}].map(({l,v,icon:Icon})=><article key={l} className="metric-card p-5"><div className="flex justify-between"><div><p className="text-xs font-extrabold text-[var(--muted)]">{l}</p><p className="mt-3 text-3xl font-black">{v.toLocaleString()}</p></div><Icon className="h-5 w-5 text-[var(--muted)]"/></div></article>)}
    </section>

    <section className="grid gap-5 xl:grid-cols-[.75fr_1.25fr]">
      <div className="space-y-5">
        <article className="premium-panel p-6"><h2 className="font-black">Delivery details</h2><div className="mt-5 space-y-3 text-sm">{[["Campaign",row.campaignName],["Subject",row.campaignSubject],["Mailbox provider",providerLabel(provider)],["Validation",row.contactValidation],["Queued",fmt(m.queuedAt)],["Accepted",fmt(m.acceptedAt)],["Delivered",fmt(m.deliveredAt)],["Bounced",fmt(m.bouncedAt)]].map(([a,b])=><div key={String(a)} className="flex gap-4 border-b border-[var(--border)] pb-3 last:border-0"><span className="w-36 shrink-0 text-[var(--muted)]">{a}</span><b className="break-all">{String(b)}</b></div>)}</div></article>
        <article className="premium-panel p-6"><h2 className="font-black">Engagement timestamps</h2><div className="mt-5 grid gap-3 text-sm"><div><span className="text-[var(--muted)]">First open</span><b className="mt-1 block">{s.first_open?fmt(new Date(String(s.first_open))):"Never"}</b></div><div><span className="text-[var(--muted)]">Last open</span><b className="mt-1 block">{s.last_open?fmt(new Date(String(s.last_open))):"Never"}</b></div><div><span className="text-[var(--muted)]">First click</span><b className="mt-1 block">{s.first_click?fmt(new Date(String(s.first_click))):"Never"}</b></div><div><span className="text-[var(--muted)]">Last click</span><b className="mt-1 block">{s.last_click?fmt(new Date(String(s.last_click))):"Never"}</b></div></div></article>
      </div>

      <article className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Activity timeline</h2><p className="mt-1 text-xs text-[var(--muted)]">Delivery and engagement activity for this recipient.</p></div>{events.length?<div className="divide-y divide-[var(--border)]">{events.map((e)=>{const payload=e.payload||{};const automated=Boolean(payload.automated);const url=typeof payload.url==="string"?payload.url:null;const customerVisible=["delivered","bounced","open","click","unsubscribe","complaint","failed","cancelled"].includes(e.type);if(!customerVisible)return null;return <div key={e.id} className="p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><span className="rounded-full bg-violet-500/10 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-300">{e.type.replaceAll("_"," ")}</span>{automated?<span className="text-[11px] font-bold text-amber-600">automated</span>:null}</div>{url?<a className="mt-2 block break-all text-sm font-bold text-violet-600 hover:underline" href={url} target="_blank" rel="noreferrer">{url}</a>:null}</div><time className="shrink-0 text-xs text-[var(--muted)]">{fmt(e.createdAt)}</time></div></div>})}</div>:<div className="grid min-h-48 place-items-center p-8 text-center text-sm text-[var(--muted)]"><Clock3 className="mb-3 h-7 w-7"/>No activity recorded yet.</div>}</article>
    </section>
  </AppShell>;
}
