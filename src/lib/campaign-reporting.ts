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
  uniqueClicks: number;
  unsubscribes: number;
  complaints: number;
  deliveryRate: number;
  bounceRate: number;
  openRate: number;
  clickRate: number;
  ctor: number;
};

const n = (value: unknown) => Number(value || 0);
const pct = (num: number, den: number) => den > 0 ? Math.round((num / den) * 10000) / 100 : 0;

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
        count(distinct message_id) filter(where type='open')::int unique_opens,
        count(distinct message_id) filter(where type='click')::int unique_clicks,
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
  const delivered = n(row.delivered), opens = n(row.unique_opens), clicks = n(row.unique_clicks), targeted = n(row.targeted), bounced = n(row.bounced);
  return {
    campaignId: String(row.campaign_id), campaignName: String(row.campaign_name), campaignStatus: String(row.campaign_status),
    targeted, queued:n(row.queued), ready:n(row.ready), sending:n(row.sending), accepted:n(row.accepted), deferred:n(row.deferred),
    delivered, bounced, failed:n(row.failed), cancelled:n(row.cancelled), uniqueOpens:opens, uniqueClicks:clicks,
    unsubscribes:n(row.unsubscribes), complaints:n(row.complaints), deliveryRate:pct(delivered,targeted), bounceRate:pct(bounced,targeted),
    openRate:pct(opens,delivered), clickRate:pct(clicks,delivered), ctor:pct(clicks,opens),
  };
}

export async function getCampaignMetricsList(limit = 50): Promise<CampaignMetrics[]> {
  const result = await db.execute(sql`
    select c.id::text campaign_id,c.name campaign_name,c.status::text campaign_status,
      count(m.id)::int targeted,
      count(m.id) filter(where m.status='queued')::int queued,
      count(m.id) filter(where m.status='ready_for_transport')::int ready,
      count(m.id) filter(where m.status='sending')::int sending,
      count(m.id) filter(where m.status='mta_accepted')::int accepted,
      count(m.id) filter(where m.status='deferred')::int deferred,
      count(m.id) filter(where m.status='delivered')::int delivered,
      count(m.id) filter(where m.status='bounced')::int bounced,
      count(m.id) filter(where m.status='failed')::int failed,
      count(m.id) filter(where m.status='cancelled')::int cancelled,
      count(distinct case when e.type='open' then e.message_id end)::int unique_opens,
      count(distinct case when e.type='click' then e.message_id end)::int unique_clicks,
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
    const row=raw as Record<string,unknown>; const targeted=n(row.targeted), delivered=n(row.delivered), bounced=n(row.bounced), opens=n(row.unique_opens), clicks=n(row.unique_clicks);
    return { campaignId:String(row.campaign_id),campaignName:String(row.campaign_name),campaignStatus:String(row.campaign_status),targeted,
      queued:n(row.queued),ready:n(row.ready),sending:n(row.sending),accepted:n(row.accepted),deferred:n(row.deferred),delivered,bounced,failed:n(row.failed),cancelled:n(row.cancelled),
      uniqueOpens:opens,uniqueClicks:clicks,unsubscribes:n(row.unsubscribes),complaints:n(row.complaints),deliveryRate:pct(delivered,targeted),bounceRate:pct(bounced,targeted),openRate:pct(opens,delivered),clickRate:pct(clicks,delivered),ctor:pct(clicks,opens)};
  });
}
