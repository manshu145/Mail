import { and, eq, lte, or } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { campaigns, contactLists, contacts, lists, messages } from "../../src/db/schema";

async function runOnce() {
  const now = new Date();
  const due = await db.select().from(campaigns).where(or(eq(campaigns.status, "queued"), and(eq(campaigns.status, "scheduled"), lte(campaigns.scheduledAt, now)))).limit(10);

  for (const campaign of due) {
    if (!campaign.listId) continue;
    const [list] = await db.select().from(lists).where(eq(lists.id, campaign.listId)).limit(1);
    if (!list || list.isDynamic) continue;

    const recipients = await db
      .select({ contactId: contacts.id, email: contacts.email })
      .from(contactLists)
      .innerJoin(contacts, eq(contactLists.contactId, contacts.id))
      .where(and(eq(contactLists.listId, campaign.listId), eq(contacts.status, "active")));

    if (recipients.length) {
      await db.insert(messages).values(recipients.map((recipient) => ({
        campaignId: campaign.id,
        contactId: recipient.contactId,
        recipientEmail: recipient.email,
        status: "queued" as const,
      }))).onConflictDoNothing({ target: [messages.campaignId, messages.contactId] });
    }

    await db.update(campaigns).set({ status: "sending", updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
    console.log(`[campaign-worker] ${campaign.id}: resolved ${recipients.length} recipients`);
  }
}

async function main() {
  await runOnce();
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => pool.end());
