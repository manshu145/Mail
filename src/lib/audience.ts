import { and, eq, ilike, ne, notIlike, sql, type SQL } from "drizzle-orm";
import { engagementAudienceSql, type EngagementRule } from "@/lib/engagement-audience";
import { db } from "@/db";
import { contacts, lists } from "@/db/schema";
import { engagementSegmentDefinitions, segmentDefinitions } from "@/db/segment-schema";

/** A database-side audience relation: no recipient-sized arrays in the app. */
export async function audienceSelection(list: typeof lists.$inferSelect, executor: Pick<typeof db, "select"> = db): Promise<SQL> {
  let condition: SQL | undefined;
  if (!list.isDynamic) {
    condition = sql`exists(select 1 from contact_lists cl where cl.contact_id=${contacts.id} and cl.list_id=${list.id})`;
  } else {
    const [engagement] = await executor.select().from(engagementSegmentDefinitions).where(eq(engagementSegmentDefinitions.listId, list.id)).limit(1);
    if (engagement) {
      condition = sql`${contacts.id} in (${engagementAudienceSql(engagement.campaignId, engagement.ruleType as EngagementRule, engagement.windowDays)})`;
    } else {
      const [rule] = await executor.select().from(segmentDefinitions).where(eq(segmentDefinitions.listId, list.id)).limit(1);
      if (!rule) condition = sql`false`;
      else if (rule.field === "email_domain") {
        const domain = rule.value.trim().replace(/^@/, "").toLowerCase();
        condition = rule.operator === "equals" ? ilike(contacts.normalizedEmail, `%@${domain}`) : notIlike(contacts.normalizedEmail, `%@${domain}`);
      } else if (rule.field === "validation_status") {
        condition = rule.operator === "equals" ? sql`${contacts.validationStatus}::text=${rule.value}` : sql`${contacts.validationStatus}::text<>${rule.value}`;
      } else if (rule.field === "custom_attribute") {
        const key = rule.attributeKey?.trim();
        const actual = sql`lower(coalesce(${contacts.attributes}->>${key || ""},''))`;
        condition = !key ? sql`false` : rule.operator === "equals" ? sql`${actual}=${rule.value.trim().toLowerCase()}` : sql`${actual}<>${rule.value.trim().toLowerCase()}`;
      } else {
        condition = rule.operator === "equals" ? eq(contacts.status, rule.value as "active" | "archived") : ne(contacts.status, rule.value as "active" | "archived");
      }
    }
  }

  return sql`select
    ${contacts.id} as contact_id,
    ${contacts.email} as email,
    ${contacts.normalizedEmail} as normalized_email,
    ${contacts.validationStatus} as validation_status,
    case
      when ${contacts.validationStatus}::text not in ('accepted','valid') then false
      when exists(
        select 1 from recipient_domain_health rdh
        where rdh.domain=lower(split_part(${contacts.normalizedEmail},'@',2))
          and rdh.status in ('no_mx','null_mx')
      ) then false
      else true
    end as send_eligible,
    not exists(
      select 1 from recipient_domain_health rdh
      where rdh.domain=lower(split_part(${contacts.normalizedEmail},'@',2))
        and rdh.status in ('no_mx','null_mx')
    ) as domain_eligible,
    case
      when ${contacts.validationStatus}::text in ('pending','unknown','error') then true
      else false
    end as awaiting_validation,
    exists(select 1 from suppressions s where s.normalized_email=${contacts.normalizedEmail}) as suppressed
  from ${contacts}
  where ${and(
    eq(contacts.status, "active"),
    eq(contacts.consentStatus, "confirmed"),
    sql`length(trim(coalesce(${contacts.consentSource},'')))>0`,
    condition,
  )}`;
}

export type AudienceRecipient = {
  contactId: string;
  email: string;
  normalizedEmail: string;
  validationStatus: "pending" | "accepted" | "valid" | "invalid" | "unknown" | "error";
};
