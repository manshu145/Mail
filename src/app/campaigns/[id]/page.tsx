import { AlertTriangle, ArrowLeft, CircleGauge, Clock3, Eye, MailCheck, MousePointerClick, ShieldCheck, TimerReset, Users } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { CampaignControl } from "@/components/campaign-control";
import { CampaignEditor } from "@/components/campaign-editor";
import { CampaignReuseAction } from "@/components/campaign-reuse-action";
import { MessageStatusBadge } from "@/components/message-status-badge";
import { db, databaseConfigured } from "@/db";
import { campaignPreflights } from "@/db/campaign-ops-schema";
import { campaigns, lists, sendingAccounts, templates } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getRuntimePolicy } from "@/lib/runtime-policy";
import { getCampaignMetrics } from "@/lib/campaign-reporting";
import { providerLabel } from "@/lib/provider";

const fmt=(value:Date|string|null|undefined)=>value?new Intl.DateTimeFormat("en",{dateStyle:"short",timeStyle:"short", timeZone:"Asia/Kolkata"}).format(new Date(value)):"—";
type DrillView="targeted"|"delivered"|"opens"|"clicks"|"bounce_failed";
type ProviderImpactRow={
  provider:string;
  affected_recipients:number;
  cooldown_events:number;
  probes:number;
  first_event:Date|string|null;
  last_event:Date|string|null;
  state:Record<string,unknown>|null;
};

function one(value:string|string[]|undefined){return Array.isArray(value)?value[0]:value}
function viewLabel(view:DrillView){
  return view==="targeted"?"Targeted recipients":view==="delivered"?"Delivered recipients":view==="opens"?"Unique openers":view==="clicks"?"Unique clickers":"Bounced / failed recipients";
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}:{
  params:Promise<{id:string}>;
  searchParams:Promise<Record<string,string|string[]|undefined>>;
}) {
  const session=await getSession();
  if(!session)redirect("/login");
  if(!databaseConfigured)notFound();

  const {id}=await params;
  const qp=await searchParams;
  const rawView=one(qp.view);
  const view:DrillView=rawView==="delivered"||rawView==="opens"||rawView==="clicks"||rawView==="bounce_failed"?rawView:"targeted";
  const clickUrl=(one(qp.url)||"").slice(0,2000);
  const selectedMessageId=(one(qp.message)||"").trim();
  const page=Math.max(1,Number(one(qp.page)||"1")||1);
  const pageSize=100;
  const offset=(page-1)*pageSize;

  const [campaign]=await db.select().from(campaigns).where(eq(campaigns.id,id)).limit(1);
  if(!campaign)notFound();

  const human=sql`coalesce((e.payload->>'automated')::boolean,false)=false`;
  let drillCondition=sql`true`;
  if(view==="delivered")drillCondition=sql`m.status='delivered'`;
  if(view==="opens")drillCondition=sql`exists(select 1 from message_events oe where oe.message_id=m.id and oe.type='open' and coalesce((oe.payload->>'automated')::boolean,false)=false)`;
  if(view==="clicks")drillCondition=clickUrl
    ? sql`exists(select 1 from message_events ce where ce.message_id=m.id and ce.type='click' and coalesce((ce.payload->>'automated')::boolean,false)=false and ce.payload->>'url'=${clickUrl})`
    : sql`exists(select 1 from message_events ce where ce.message_id=m.id and ce.type='click' and coalesce((ce.payload->>'automated')::boolean,false)=false)`;
  if(view==="bounce_failed")drillCondition=sql`m.status in ('bounced','failed')`;

  const [listRows,templateRows,accountRows,metrics,recipientResult,recipientCountResult,linkResult,preflightRows,selectedResult,providerImpactResult,providerStateResult]=await Promise.all([
    db.select({id:lists.id,name:lists.name}).from(lists),
    db.select({id:templates.id,name:templates.name}).from(templates),
    db.select({id:sendingAccounts.id,name:sendingAccounts.name,fromName:sendingAccounts.fromName,fromEmail:sendingAccounts.fromEmail,replyTo:sendingAccounts.replyTo}).from(sendingAccounts).where(eq(sendingAccounts.status,"active")),
    getCampaignMetrics(id),
    db.execute(sql`
      select
        m.id::text,
        m.contact_id::text,
        m.recipient_email,
        coalesce(nullif(trim(concat_ws(' ',c.first_name,c.last_name)),''),m.recipient_email) contact_name,
        m.status::text,
        m.provider_message_id,
        m.queued_at,
        m.accepted_at,
        m.delivered_at,
        m.bounced_at,
        m.last_error,
        count(distinct case when e.type='open' and ${human} then
          e.message_id::text || ':' ||
          coalesce(e.payload->>'userAgent','') || ':' ||
          floor(extract(epoch from e.created_at) / 300)::text
        end)::int opens,
        count(e.id) filter(where e.type='click' and ${human})::int clicks,
        min(e.created_at) filter(where e.type='open' and ${human}) first_open,
        max(e.created_at) filter(where e.type='open' and ${human}) last_open,
        min(e.created_at) filter(where e.type='click' and ${human}) first_click,
        max(e.created_at) filter(where e.type='click' and ${human}) last_click,
        array_remove(array_agg(distinct e.payload->>'url') filter(where e.type='click' and ${human} and nullif(e.payload->>'url','') is not null),null) clicked_urls
      from messages m
      join contacts c on c.id=m.contact_id
      left join message_events e on e.message_id=m.id
      where m.campaign_id=${id} and ${drillCondition}
      group by m.id,c.id
      order by m.queued_at desc
      limit ${pageSize} offset ${offset}
    `),
    db.execute(sql`select count(*)::int total from messages m where m.campaign_id=${id} and ${drillCondition}`),
    db.execute(sql`
      select e.payload->>'url' url,
        count(*) filter(where coalesce((e.payload->>'automated')::boolean,false)=false)::int clicks,
        count(distinct e.message_id) filter(where coalesce((e.payload->>'automated')::boolean,false)=false)::int unique_clickers
      from message_events e
      join messages m on m.id=e.message_id
      where m.campaign_id=${id} and e.type='click' and e.payload->>'url' is not null
      group by e.payload->>'url'
      having count(*) filter(where coalesce((e.payload->>'automated')::boolean,false)=false)>0
      order by clicks desc
      limit 50
    `),
    db.select().from(campaignPreflights).where(eq(campaignPreflights.campaignId,id)).limit(1),
    selectedMessageId&&/^[0-9a-f-]{36}$/i.test(selectedMessageId)
      ? db.execute(sql`
          select m.id::text,m.recipient_email,m.status::text,
            coalesce(nullif(trim(concat_ws(' ',c.first_name,c.last_name)),''),m.recipient_email) contact_name,
            e.id::text event_id,e.type,e.payload,e.created_at
          from messages m
          join contacts c on c.id=m.contact_id
          left join message_events e on e.message_id=m.id
          where m.id=${selectedMessageId} and m.campaign_id=${id}
          order by e.created_at desc nulls last
          limit 250
        `)
      : Promise.resolve({rows:[]} as {rows:unknown[]}),
    db.execute(sql`
      with impact as (
        select
          nullif(e.payload->>'provider','') provider,
          m.id::text message_id,
          e.type,
          e.created_at,
          coalesce((e.payload->>'providerCooldown')::boolean,false) provider_cooldown
        from message_events e
        join messages m on m.id=e.message_id
        where m.campaign_id=${id}
          and (
            e.type in ('provider_cooldown','provider_probe')
            or (
              e.type in ('postfix_deferred','postfix_bounced')
              and coalesce((e.payload->>'providerCooldown')::boolean,false)=true
            )
          )
      )
      select provider,
        count(distinct message_id)::int affected_recipients,
        min(created_at) first_event,
        max(created_at) last_event,
        count(*) filter(where provider_cooldown or type='provider_cooldown')::int cooldown_events,
        count(*) filter(where type='provider_probe')::int probes
      from impact
      where provider is not null
      group by provider
      order by affected_recipients desc, provider asc
    `),
    campaign.sendingAccountId
      ? db.execute(sql`
          select provider,active,reason,last_response,detected_at,next_probe_at,last_probe_at,cleared_at
          from provider_cooldowns
          where sending_account_id=${campaign.sendingAccountId}
        `)
      : Promise.resolve({rows:[]} as {rows:unknown[]}),
  ]);

  const recipientRows=recipientResult.rows as Array<Record<string,unknown>>;
  const recipientTotal=Number((recipientCountResult.rows[0] as Record<string,unknown>|undefined)?.total||0);
  const totalPages=Math.max(1,Math.ceil(recipientTotal/pageSize));
  const links=linkResult.rows as Array<Record<string,unknown>>;
  const selectedRows=selectedResult.rows as Array<Record<string,unknown>>;
  const selectedRecipient=selectedRows[0]||null;
  const providerStates=new Map((providerStateResult.rows as Array<Record<string,unknown>>).map((row)=>[String(row.provider),row]));
  const providerImpact:ProviderImpactRow[]=(providerImpactResult.rows as Array<Record<string,unknown>>).map((row)=>{
    const provider=String(row.provider||"");
    return {
      provider,
      affected_recipients:Number(row.affected_recipients||0),
      cooldown_events:Number(row.cooldown_events||0),
      probes:Number(row.probes||0),
      first_event:(row.first_event as Date|string|null)||null,
      last_event:(row.last_event as Date|string|null)||null,
      state:providerStates.get(provider)||null,
    };
  });
  const preflight=preflightRows[0]||null;
  const editable=["draft","paused","scheduled"].includes(campaign.status);
  const runtimePolicy=getRuntimePolicy();
  const inFlight=metrics?metrics.queued+metrics.ready+metrics.sending+metrics.accepted+metrics.deferred:0;

  const cardData=metrics?[
    {label:"Targeted",count:metrics.targeted,icon:Users,view:"targeted" as DrillView,tone:"text-violet-600"},
    {label:"Delivered",count:metrics.delivered,icon:MailCheck,view:"delivered" as DrillView,tone:"text-emerald-600"},
    {label:"Unique opens",count:metrics.uniqueOpens,icon:Eye,view:"opens" as DrillView,tone:"text-blue-600"},
    {label:"Unique clicks",count:metrics.uniqueClicks,icon:MousePointerClick,view:"clicks" as DrillView,tone:"text-cyan-600"},
  ]:[];

  const drillHref=(nextView:DrillView,nextPage=1,extraUrl="")=>{
    const query=new URLSearchParams({view:nextView,page:String(nextPage)});
    if(extraUrl)query.set("url",extraUrl);
    return `/campaigns/${id}?${query.toString()}#recipient-drilldown`;
  };

  return <AppShell session={session}>
    <div className="mb-7">
      <Link className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[var(--muted)] hover:text-[var(--foreground)]" href="/campaigns"><ArrowLeft className="h-4 w-4"/>Campaigns</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="page-eyebrow">Campaign report</p><h1 className="mt-2 text-3xl font-black tracking-[-.035em] sm:text-4xl">{campaign.name}</h1><p className="mt-2 text-sm text-[var(--muted)]">{campaign.subject}</p></div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end"><span className="rounded-full bg-violet-500/10 px-3 py-1.5 text-xs font-extrabold capitalize text-violet-700 dark:text-violet-300">{campaign.status}</span><CampaignReuseAction campaignId={campaign.id} lists={listRows} currentListId={campaign.listId}/><CampaignControl id={campaign.id} status={campaign.status} failed={metrics?.failed||0}/></div>
      </div>
    </div>

    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[["Created",fmt(campaign.createdAt)],["Started",fmt(campaign.startedAt)],["Completed",fmt(campaign.completedAt)],["Scheduled",fmt(campaign.scheduledAt)]].map(([label,value])=><article key={label} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1.5 text-sm font-black">{value}</p></article>)}
    </section>

    {campaign.lastError?<div className="mb-5 rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3 text-sm font-semibold text-rose-600">{campaign.lastError}</div>:null}

    {metrics&&metrics.targeted>0?<>
      <section className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cardData.map(({label,count,icon:Icon,view:cardView,tone})=><Link href={drillHref(cardView)} className={`premium-panel block p-5 transition ${cardView==="delivered"?"border-emerald-500/15 bg-emerald-500/[0.025]":cardView==="opens"?"border-blue-500/15 bg-blue-500/[0.025]":cardView==="clicks"?"border-cyan-500/15 bg-cyan-500/[0.025]":"border-violet-500/15 bg-violet-500/[0.025]"} ${view===cardView?"ring-2 ring-violet-500/30":""}`} key={label}><div className="flex items-start justify-between"><div><p className="text-sm font-bold text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-black">{Number(count).toLocaleString()}</p><p className="mt-2 text-[11px] font-bold text-violet-600">View recipients →</p></div><Icon className={`h-5 w-5 ${tone}`}/></div></Link>)}
      </section>
      <section className="mb-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">{[["Delivery progress",metrics.deliveryProgressRate],["Open rate",metrics.openRate],["Click rate",metrics.clickRate],["CTOR",metrics.ctor],["Bounce",metrics.bounceRate],["Unsubscribes",metrics.unsubscribes]].map(([label,value])=><article key={String(label)} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1.5 text-xl font-black">{label==="Unsubscribes"?Number(value).toLocaleString():`${Number(value).toFixed(2)}%`}</p></article>)}</section>
      {inFlight>0?<div className="mb-5 rounded-2xl border border-blue-500/15 bg-blue-500/[0.05] px-4 py-3 text-xs font-semibold text-blue-700 dark:text-blue-300">{inFlight.toLocaleString()} {inFlight===1?"recipient is":"recipients are"} still queued/in transport. Delivery progress is based on all targeted recipients, not only finalized outcomes.</div>:null}

      <section className="premium-panel mb-5 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <p className="page-eyebrow">Deliverability</p>
            <h2 className="mt-1 text-lg font-black">Provider impact during this campaign</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Temporary mailbox-provider throttling or cooldown events recorded from this campaign's actual delivery events.</p>
          </div>
          <Link href="/provider-cooldowns" className="btn-secondary !min-h-9 !px-3 text-xs"><TimerReset className="h-4 w-4"/>All provider cooldowns</Link>
        </div>

        {providerImpact.length?<div className="grid gap-px bg-[var(--border)] lg:grid-cols-2">
          {providerImpact.map((row)=>{
            const provider=String(row.provider);
            const state=row.state as Record<string,unknown>|null;
            const active=Boolean(state?.active);
            return <article key={provider} className="min-w-0 bg-[var(--surface)] p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-black">{providerLabel(provider)}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[.08em] ${active?"bg-amber-500/10 text-amber-700 dark:text-amber-300":"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>{active?"Cooldown active":"Not active now"}</span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{Number(row.affected_recipients||0).toLocaleString()} affected recipient{Number(row.affected_recipients||0)===1?"":"s"} · {Number(row.cooldown_events||0).toLocaleString()} cooldown event{Number(row.cooldown_events||0)===1?"":"s"}</p>
                </div>
                {active?<AlertTriangle className="h-5 w-5 shrink-0 text-amber-500"/>:<ShieldCheck className="h-5 w-5 shrink-0 text-emerald-500"/>}
              </div>

              <div className="mt-4 grid gap-2 min-[420px]:grid-cols-2">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3"><p className="text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">First impact</p><p className="mt-1 text-xs font-bold">{fmt(row.first_event as string|null)}</p></div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3"><p className="text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">Last impact</p><p className="mt-1 text-xs font-bold">{fmt(row.last_event as string|null)}</p></div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3"><p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]"><Clock3 className="h-3 w-3"/>Next probe</p><p className="mt-1 text-xs font-bold">{active?fmt(state?.next_probe_at as string|null):"—"}</p></div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3"><p className="text-[10px] font-black uppercase tracking-[.1em] text-[var(--muted)]">Probe attempts</p><p className="mt-1 text-xs font-bold">{Number(row.probes||0).toLocaleString()}</p></div>
              </div>

              {state?.reason?<p className="mt-3 break-words rounded-xl border border-amber-500/15 bg-amber-500/[0.05] px-3 py-2.5 text-xs leading-5 text-amber-800 dark:text-amber-200"><b>Reason:</b> {String(state.reason)}</p>:null}
              {state?.last_response?<details className="mt-2 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5"><summary className="cursor-pointer text-[11px] font-black">Last provider response</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-[var(--muted)]">{String(state.last_response)}</pre></details>:null}
            </article>;
          })}
        </div>:<div className="flex items-start gap-3 p-4 sm:p-5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600"><ShieldCheck className="h-4 w-4"/></div>
          <div><h3 className="text-sm font-black">No provider pressure recorded</h3><p className="mt-1 text-xs leading-5 text-[var(--muted)]">This campaign has no recorded provider cooldown or temporary provider-throttling events.</p></div>
        </div>}
      </section>
      <section className="mb-5 grid gap-5 xl:grid-cols-2">
        <article className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Delivery funnel</h2><p className="mt-1 text-xs text-[var(--muted)]">Click a state to inspect the actual recipients.</p></div><div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">{[
          ["Targeted",metrics.targeted,"targeted" as DrillView],["Delivered",metrics.delivered,"delivered" as DrillView],["In flight",inFlight,null],["Bounced",metrics.bounced,"bounce_failed" as DrillView],["Failed",metrics.failed,"bounce_failed" as DrillView],["Cancelled",metrics.cancelled,null],
        ].map(([label,value,target])=>target?<Link href={drillHref(target as DrillView)} key={String(label)} className="bg-[var(--surface)] p-4 transition hover:bg-[var(--surface-soft)]"><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1 text-2xl font-black">{Number(value).toLocaleString()}</p></Link>:<div key={String(label)} className="bg-[var(--surface)] p-4"><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1 text-2xl font-black">{Number(value).toLocaleString()}</p></div>)}</div></article>
        <article className="premium-panel overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Engagement quality</h2><p className="mt-1 text-xs text-[var(--muted)]">Verified human activity excludes known scanners/previews.</p></div><div className="grid gap-px bg-[var(--border)] sm:grid-cols-2">{[
          ["Unique opens",metrics.uniqueOpens,"opens" as DrillView],["Total opens",metrics.totalOpens,"opens" as DrillView],["Unique clickers",metrics.uniqueClicks,"clicks" as DrillView],["Total clicks",metrics.totalClicks,"clicks" as DrillView],["Automated opens",metrics.automatedOpens,null],["Automated clicks",metrics.automatedClicks,null],
        ].map(([label,value,target])=>target?<Link href={drillHref(target as DrillView)} key={String(label)} className="bg-[var(--surface)] p-4 transition hover:bg-[var(--surface-soft)]"><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1 text-2xl font-black">{Number(value).toLocaleString()}</p></Link>:<div key={String(label)} className="bg-[var(--surface)] p-4"><p className="text-xs font-bold text-[var(--muted)]">{label}</p><p className="mt-1 text-2xl font-black">{Number(value).toLocaleString()}</p></div>)}</div></article>
      </section>
    </>:null}

    {editable?<section className="premium-panel p-3 sm:p-5 lg:p-6"><CampaignEditor campaign={{...campaign,scheduledAt:campaign.scheduledAt?.toISOString()||null}} lists={listRows} templates={templateRows} accounts={accountRows} runtimePolicy={{mode:runtimePolicy.mode,sendingEnabled:runtimePolicy.sendingEnabled,maxRecipientsPerCampaign:runtimePolicy.maxRecipientsPerCampaign}}/></section>:<section className="premium-panel p-4 sm:p-6"><div className="grid min-h-32 place-items-center text-center"><div><CircleGauge className="mx-auto h-8 w-8 text-[var(--muted)]"/><h2 className="mt-4 font-black">Delivery processing</h2><p className="mt-1 text-sm text-[var(--muted)]">Editing is locked after the audience snapshot begins.</p></div></div></section>}

    {links.length?<section className="premium-panel mt-5 overflow-hidden"><div className="border-b border-[var(--border)] p-5"><h2 className="font-black">Clicked links</h2><p className="mt-1 text-xs text-[var(--muted)]">Click a URL row to see exactly who clicked it.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-5 py-3">URL</th><th>Unique clickers</th><th>Total clicks</th></tr></thead><tbody>{links.map((row,i)=>{const url=String(row.url||"");return <tr className="border-t border-[var(--border)] transition hover:bg-[var(--surface-soft)]" key={`${url}-${i}`}><td className="max-w-[620px] truncate px-5 py-3.5"><Link className="font-semibold text-violet-600 hover:underline" href={drillHref("clicks",1,url)}>{url}</Link></td><td>{Number(row.unique_clickers||0).toLocaleString()}</td><td>{Number(row.clicks||0).toLocaleString()}</td></tr>})}</tbody></table></div></section>:null}

    <section id="recipient-drilldown" className="premium-panel mt-5 overflow-hidden scroll-mt-24">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="page-eyebrow">Recipient drill-down</p><h2 className="mt-1 text-lg font-black">{viewLabel(view)} · {recipientTotal.toLocaleString()}</h2><p className="mt-1 text-[11px] text-[var(--muted)]">{clickUrl?`Filtered to clicks on ${clickUrl}`:"Select any row to open that recipient's campaign event log below."}</p></div>
        <div className="flex flex-wrap gap-2">
          {([
            ["targeted","Targeted"],["delivered","Delivered"],["opens","Opened"],["clicks","Clicked"],["bounce_failed","Bounce / failed"],
          ] as Array<[DrillView,string]>).map(([key,label])=><Link key={key} href={drillHref(key)} className={`rounded-xl border px-3 py-2 text-xs font-extrabold transition ${view===key?"border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300":"border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)] hover:text-[var(--foreground)]"}`}>{label}</Link>)}
        </div>
      </div>

      {recipientRows.length?<div className="overflow-x-auto"><table className="w-full min-w-[1160px] text-left text-sm"><thead className="bg-[var(--surface-soft)] text-[10px] font-black uppercase tracking-[.12em] text-[var(--muted)]"><tr><th className="px-4 py-2.5 sm:px-5">Recipient</th><th>Status</th><th>Open sessions</th><th>Clicks</th><th>First / last open</th><th>First / last click</th><th>Delivered</th><th className="pr-4 sm:pr-5">Detail</th></tr></thead><tbody>{recipientRows.map((m)=>{
        const messageId=String(m.id);
        const rowQuery=new URLSearchParams({view,page:String(page),message:messageId});
        if(clickUrl)rowQuery.set("url",clickUrl);
        return <tr className={`border-t border-[var(--border)] transition hover:bg-[var(--surface-soft)] ${selectedMessageId===messageId?"bg-violet-500/[0.045]":""}`} key={messageId}>
          <td className="px-4 py-3 sm:px-5"><Link href={`/campaigns/${id}?${rowQuery.toString()}#recipient-event-log`} className="font-black hover:text-violet-700 dark:hover:text-violet-300">{String(m.contact_name||m.recipient_email)}</Link><div className="mt-0.5 text-[11px] text-[var(--muted)]">{String(m.recipient_email)}</div></td>
          <td><MessageStatusBadge status={String(m.status)} compact/></td>
          <td className="font-bold">{Number(m.opens||0).toLocaleString()}</td>
          <td className="font-bold">{Number(m.clicks||0).toLocaleString()}</td>
          <td className="text-[11px] text-[var(--muted)]">{fmt(m.first_open as string|null)}<br/>{fmt(m.last_open as string|null)}</td>
          <td className="text-[11px] text-[var(--muted)]">{fmt(m.first_click as string|null)}<br/>{fmt(m.last_click as string|null)}</td>
          <td className="text-[11px] text-[var(--muted)]">{fmt(m.delivered_at as string|null)}</td>
          <td className="max-w-[260px] truncate pr-4 text-[11px] text-rose-500 sm:pr-5" title={String(m.last_error||"")}>{String(m.last_error||"—")}</td>
        </tr>})}</tbody></table></div>:<div className="grid min-h-40 place-items-center p-8 text-center text-sm text-[var(--muted)]">No recipients match this report filter.</div>}

      {recipientTotal>pageSize?<div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-xs sm:px-5"><span className="font-bold text-[var(--muted)]">Page {page} of {totalPages}</span><div className="flex gap-2">{page>1?<Link className="btn-secondary !min-h-8 !px-3 !py-1.5 text-xs" href={drillHref(view,page-1,clickUrl)}>Previous</Link>:null}{page<totalPages?<Link className="btn-secondary !min-h-8 !px-3 !py-1.5 text-xs" href={drillHref(view,page+1,clickUrl)}>Next</Link>:null}</div></div>:null}
    </section>

    {selectedRecipient?<section id="recipient-event-log" className="premium-panel mt-5 overflow-hidden scroll-mt-24">
      <div className="border-b border-[var(--border)] p-5"><p className="page-eyebrow">Selected recipient</p><h2 className="mt-1 text-lg font-black">{String(selectedRecipient.contact_name)}</h2><p className="mt-1 text-xs text-[var(--muted)]">{String(selectedRecipient.recipient_email)} · <MessageStatusBadge status={String(selectedRecipient.status)} compact/></p></div>
      <div className="divide-y divide-[var(--border)]">
        {selectedRows.filter((row)=>row.event_id).length?selectedRows.filter((row)=>row.event_id).map((row)=>{
          const payload=(row.payload||{}) as Record<string,unknown>;
          const automated=Boolean(payload.automated);
          const url=typeof payload.url==="string"?payload.url:null;
          const type=String(row.type||"event");
          const tone=type.includes("bounce")||type==="failed"?"bg-rose-500/10 text-rose-700 dark:text-rose-300":type==="open"||type==="click"||type.includes("deliver")?"bg-emerald-500/10 text-emerald-700 dark:text-emerald-300":"bg-blue-500/10 text-blue-700 dark:text-blue-300";
          return <div key={String(row.event_id)} className="p-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${tone}`}>{type.replaceAll("_"," ")}</span>{automated?<span className="text-[10px] font-bold text-amber-600">automated</span>:null}{payload.proxyProvider==="google_image_proxy"?<span className="text-[10px] font-bold text-blue-600">Gmail image proxy</span>:null}</div>{url?<a href={url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs font-bold text-violet-600 hover:underline">{url}</a>:null}<details className="mt-2"><summary className="cursor-pointer text-[11px] font-bold text-[var(--muted)]">Technical details</summary><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--surface-soft)] p-3 font-mono text-[10px] leading-5 text-[var(--muted)]">{Object.keys(payload).length?JSON.stringify(payload,null,2):"No additional payload"}</pre></details></div><time className="shrink-0 text-[11px] text-[var(--muted)]">{fmt(row.created_at as string|null)}</time></div></div>
        }):<div className="p-8 text-center text-sm text-[var(--muted)]">No event timeline recorded for this recipient yet.</div>}
      </div>
    </section>:null}
  </AppShell>;
}
