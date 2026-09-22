import { sql } from "drizzle-orm";
import { db } from "@/db";

export type CampaignMetrics = {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  targeted: number;
  queued: number;
  ready: number;
  sending: number;
  accepted: number;
  deferred: number;
  delivered: number;
  bounced: number;
  failed: number;
  cancelled: number;
  uniqueOpens: number;
  totalOpens: number;
  uniqueClicks: number;
  totalClicks: number;
  automatedOpens: number;
  automatedClicks: number;
  unsubscribes: number;
  complaints: number;
  deliveryRate: number;
  deliveryProgressRate: number;
  bounceRate: number;
  openRate: number;
  clickRate: number;
  ctor: number;
};

const n = (value: unknown) => Number(value || 0);
const pct = (num: number, den: number) => den > 0 ? Math.round((num / den) * 10000) / 100 : 0;
const humanEvent = sql`coalesce((payload->>'qualified')::boolean,coalesce((payload->>'automated')::boolean,false)=false)=true`;

function outcomeRates(delivered: number, bounced: number, failed: number) {
  const finalized = delivered + bounced + failed;
  return {
    deliveryRate: pct(delivered, finalized),
    bounceRate: pct(bounced, finalized),
  };
}

export async function getCampaignMetrics(campaignId: string): Promise<CampaignMetrics | null> {
  const result = await db.execute(sql`
    with m as (
      select
        count(*)::int targeted,
        count(*) filter(where status='queued')::int queued,
        count(*) filter(where status='ready_for_transport')::int ready,
        count(*) filter(where status='sending')::int sending,
        count(*) filter(where status='mta_accepted')::int accepted,
        count(*) filter(where status='deferred')::int deferred,
        count(*) filter(where status='delivered')::int delivered,
        count(*) filter(where status='bounced')::int bounced,
        count(*) filter(where status='failed')::int failed,
        count(*) filter(where status='cancelled')::int cancelled
      from messages where campaign_id=${campaignId}
    ), e as (
      select
        count(distinct message_id) filter(where type='open' and ${humanEvent})::int unique_opens,
        count(distinct (
          message_id::text || ':' ||
          coalesce(payload->>'userAgent','') || ':' ||
          floor(extract(epoch from created_at) / 300)::text
        )) filter(where type='open' and ${humanEvent})::int total_opens,
        count(distinct message_id) filter(where type='click' and ${humanEvent})::int unique_clicks,
        count(*) filter(where type='click' and ${humanEvent})::int total_clicks,
        count(*) filter(where type='open' and coalesce((payload->>'qualified')::boolean,coalesce((payload->>'automated')::boolean,false)=false)=false)::int automated_opens,
        count(*) filter(where type='click' and coalesce((payload->>'qualified')::boolean,coalesce((payload->>'automated')::boolean,false)=false)=false)::int automated_clicks,
        count(distinct message_id) filter(where type='unsubscribe')::int unsubscribes,
        count(distinct message_id) filter(where type='complaint')::int complaints
      from message_events
      where message_id in (select id from messages where campaign_id=${campaignId})
    )
    select c.id::text campaign_id,c.name campaign_name,c.status::text campaign_status,m.*,e.*
    from campaigns c cross join m cross join e where c.id=${campaignId}
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const delivered = n(row.delivered), opens = n(row.unique_opens), clicks = n(row.unique_clicks), targeted = n(row.targeted), bounced = n(row.bounced), failed = n(row.failed);
  const rates = outcomeRates(delivered, bounced, failed);
  return {
    campaignId: String(row.campaign_id), campaignName: String(row.campaign_name), campaignStatus: String(row.campaign_status),
    targeted, queued:n(row.queued), ready:n(row.ready), sending:n(row.sending), accepted:n(row.accepted), deferred:n(row.deferred),
    delivered, bounced, failed, cancelled:n(row.cancelled), uniqueOpens:opens, totalOpens:n(row.total_opens), uniqueClicks:clicks, totalClicks:n(row.total_clicks), automatedOpens:n(row.automated_opens), automatedClicks:n(row.automated_clicks),
    unsubscribes:n(row.unsubscribes), complaints:n(row.complaints), deliveryRate:rates.deliveryRate, deliveryProgressRate:pct(delivered,targeted), bounceRate:rates.bounceRate,
    openRate:pct(opens,delivered), clickRate:pct(clicks,delivered), ctor:pct(clicks,opens),
  };
}

export async function getCampaignMetricsList(limit = 50): Promise<CampaignMetrics[]> {
  const result = await db.execute(sql`
    select c.id::text campaign_id,c.name campaign_name,c.status::text campaign_status,
      count(distinct m.id)::int targeted,
      count(distinct m.id) filter(where m.status='queued')::int queued,
      count(distinct m.id) filter(where m.status='ready_for_transport')::int ready,
      count(distinct m.id) filter(where m.status='sending')::int sending,
      count(distinct m.id) filter(where m.status='mta_accepted')::int accepted,
      count(distinct m.id) filter(where m.status='deferred')::int deferred,
      count(distinct m.id) filter(where m.status='delivered')::int delivered,
      count(distinct m.id) filter(where m.status='bounced')::int bounced,
      count(distinct m.id) filter(where m.status='failed')::int failed,
      count(distinct m.id) filter(where m.status='cancelled')::int cancelled,
      count(distinct case when e.type='open' and coalesce((e.payload->>'qualified')::boolean,coalesce((e.payload->>'automated')::boolean,false)=false)=true then e.message_id end)::int unique_opens,
      count(distinct (
        e.message_id::text || ':' ||
        coalesce(e.payload->>'userAgent','') || ':' ||
        floor(extract(epoch from e.created_at) / 300)::text
      )) filter(where e.type='open' and coalesce((e.payload->>'qualified')::boolean,coalesce((e.payload->>'automated')::boolean,false)=false)=true)::int total_opens,
      count(distinct case when e.type='click' and coalesce((e.payload->>'qualified')::boolean,coalesce((e.payload->>'automated')::boolean,false)=false)=true then e.message_id end)::int unique_clicks,
      count(e.id) filter(where e.type='click' and coalesce((e.payload->>'qualified')::boolean,coalesce((e.payload->>'automated')::boolean,false)=false)=true)::int total_clicks,
      count(e.id) filter(where e.type='open' and coalesce((e.payload->>'qualified')::boolean,coalesce((e.payload->>'automated')::boolean,false)=false)=false)::int automated_opens,
      count(e.id) filter(where e.type='click' and coalesce((e.payload->>'qualified')::boolean,coalesce((e.payload->>'automated')::boolean,false)=false)=false)::int automated_clicks,
      count(distinct case when e.type='unsubscribe' then e.message_id end)::int unsubscribes,
      count(distinct case when e.type='complaint' then e.message_id end)::int complaints
    from campaigns c
    left join messages m on m.campaign_id=c.id
    left join message_events e on e.message_id=m.id
    group by c.id,c.name,c.status,c.created_at
    order by c.created_at desc
    limit ${limit}
  `);
  return result.rows.map((raw) => {
    const row=raw as Record<string,unknown>;
    const targeted=n(row.targeted), delivered=n(row.delivered), bounced=n(row.bounced), failed=n(row.failed), opens=n(row.unique_opens), clicks=n(row.unique_clicks);
    const rates=outcomeRates(delivered,bounced,failed);
    return { campaignId:String(row.campaign_id),campaignName:String(row.campaign_name),campaignStatus:String(row.campaign_status),targeted,
      queued:n(row.queued),ready:n(row.ready),sending:n(row.sending),accepted:n(row.accepted),deferred:n(row.deferred),delivered,bounced,failed,cancelled:n(row.cancelled),
      uniqueOpens:opens,totalOpens:n(row.total_opens),uniqueClicks:clicks,totalClicks:n(row.total_clicks),automatedOpens:n(row.automated_opens),automatedClicks:n(row.automated_clicks),unsubscribes:n(row.unsubscribes),complaints:n(row.complaints),deliveryRate:rates.deliveryRate,deliveryProgressRate:pct(delivered,targeted),bounceRate:rates.bounceRate,openRate:pct(opens,delivered),clickRate:pct(clicks,delivered),ctor:pct(clicks,opens)};
  });
}
