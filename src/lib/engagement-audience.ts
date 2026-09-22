import { sql } from "drizzle-orm";
export const ENGAGEMENT_RULES = ["opened", "clicked", "not_opened", "not_clicked", "delivered_not_opened", "opened_not_clicked"] as const;
export type EngagementRule = typeof ENGAGEMENT_RULES[number];

export function engagementAudienceSql(campaignId: string, rule: EngagementRule, windowDays: number | null) {
  if (!ENGAGEMENT_RULES.includes(rule)) throw new Error("Unsupported engagement rule");
  const event = (type: string) => sql`exists(select 1 from message_events e where e.message_id=m.id and e.type=${type}
    and coalesce((e.payload->>'qualified')::boolean,coalesce((e.payload->>'automated')::boolean,false)=false)=true
    ${windowDays ? sql`and e.created_at >= now()-(${windowDays}::int * interval '1 day')` : sql``})`;
  const condition = rule === "opened" ? event("open") : rule === "clicked" ? event("click")
    : rule === "not_clicked" ? sql`not ${event("click")}`
    : rule === "opened_not_clicked" ? sql`${event("open")} and not ${event("click")}` : sql`not ${event("open")}`;
  const negative = ["not_opened", "not_clicked", "delivered_not_opened"].includes(rule);
  return sql`select distinct c.id as contact_id from messages m join contacts c on c.id=m.contact_id
    where m.campaign_id=${campaignId} and m.status='delivered' and c.status='active'
      and c.consent_status='confirmed' and length(trim(coalesce(c.consent_source,'')))>0
      and c.validation_status<>'invalid' and not exists(select 1 from suppressions s where s.normalized_email=c.normalized_email)
      and (${condition})
      ${negative && windowDays ? sql`and m.delivered_at >= now()-(${windowDays}::int * interval '1 day')` : sql``}`;
}
