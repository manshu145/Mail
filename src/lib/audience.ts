import { and, eq, ilike, ne, notIlike } from "drizzle-orm";
import { db } from "@/db";
import { contactLists, contacts, lists } from "@/db/schema";
import { segmentDefinitions } from "@/db/segment-schema";

export type AudienceRecipient = {
  contactId: string;
  email: string;
  normalizedEmail: string;
  validationStatus: "pending" | "accepted" | "valid" | "invalid" | "unknown" | "error";
};

const selection = { contactId: contacts.id, email: contacts.email, normalizedEmail: contacts.normalizedEmail, validationStatus: contacts.validationStatus };

export async function resolveAudienceRecipients(list: typeof lists.$inferSelect): Promise<AudienceRecipient[]> {
  if (!list.isDynamic) return db.select(selection).from(contactLists).innerJoin(contacts, eq(contactLists.contactId, contacts.id)).where(and(eq(contactLists.listId, list.id), eq(contacts.status, "active")));
  const [rule] = await db.select().from(segmentDefinitions).where(eq(segmentDefinitions.listId, list.id)).limit(1);
  if (!rule) return [];
  let condition;
  if (rule.field === "email_domain") {
    const domain = rule.value.trim().replace(/^@/, "").toLowerCase();
    condition = rule.operator === "equals" ? ilike(contacts.normalizedEmail, `%@${domain}`) : notIlike(contacts.normalizedEmail, `%@${domain}`);
  } else if (rule.field === "validation_status") {
    const status = rule.value as "pending" | "accepted" | "valid" | "invalid" | "unknown" | "error";
    condition = rule.operator === "equals" ? eq(contacts.validationStatus, status) : ne(contacts.validationStatus, status);
  } else {
    const status = rule.value as "active" | "archived";
    condition = rule.operator === "equals" ? eq(contacts.status, status) : ne(contacts.status, status);
  }
  return db.select(selection).from(contacts).where(and(eq(contacts.status, "active"), condition));
}
