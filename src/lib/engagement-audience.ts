import { pool } from "@/db";
import type { AudienceRecipient } from "@/lib/audience";

export const ENGAGEMENT_RULES = ["opened", "clicked", "not_opened", "not_clicked", "delivered_not_opened", "opened_not_clicked"] as const;
export type EngagementRule = typeof ENGAGEMENT_RULES[number];

function eventPredicate(type: "open" | "click", windowDays: number | null, negate = false) {
  const window = windowDays ? ` and e.created_at >= now() - ($2::int * interval '1 day')` : "";
  const exists = `exists (select 1 from message_events e where e.message_id=m.id and e.type='${type}' and coalesce((e.payload->>'automated')::boolean,false)=false${window})`;
  return negate ? `not ${exists}` : exists;
}

export async function resolveEngagementAudience(campaignId: string, rule: EngagementRule, windowDays: number | null): Promise<AudienceRecipient[]> {
  const params: unknown[] = [campaignId];
  if (windowDays) params.push(windowDays);

  // Follow-up audiences only use recipients that reached a final remote-accepted
  // delivery state. Bounced, failed, queued and still in-flight recipients are never
  // pulled back into engagement targeting.
  const negativeRule = rule === "not_opened" || rule === "not_clicked" || rule === "delivered_not_opened";
  const deliveryWindow = windowDays && negativeRule
    ? ` and m.delivered_at >= now() - ($2::int * interval '1 day')`
    : "";

  let condition = "true";
  if (rule === "opened") condition = eventPredicate("open", windowDays);
  else if (rule === "clicked") condition = eventPredicate("click", windowDays);
  else if (rule === "not_opened") condition = eventPredicate("open", windowDays, true);
  else if (rule === "not_clicked") condition = eventPredicate("click", windowDays, true);
  else if (rule === "delivered_not_opened") condition = eventPredicate("open", windowDays, true);
  else if (rule === "opened_not_clicked") condition = `${eventPredicate("open", windowDays)} and ${eventPredicate("click", windowDays, true)}`;

  const result = await pool.query<{ contact_id: string; email: string; normalized_email: string; validation_status: AudienceRecipient["validationStatus"] }>(`
    select distinct c.id as contact_id, c.email, c.normalized_email, c.validation_status
    from messages m
    join contacts c on c.id=m.contact_id
    where m.campaign_id=$1
      and m.status='delivered'
      and c.status='active'
      and c.consent_status='confirmed'
      and length(trim(coalesce(c.consent_source,''))) > 0
      and c.validation_status <> 'invalid'
      and not exists (
        select 1 from suppressions s where s.normalized_email=c.normalized_email
      )
      ${deliveryWindow}
      and (${condition})
    order by c.id
  `, params);
  return result.rows.map((row) => ({ contactId: row.contact_id, email: row.email, normalizedEmail: row.normalized_email, validationStatus: row.validation_status }));
}
