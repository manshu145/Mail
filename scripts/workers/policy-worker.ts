import { eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import { contacts, messages, suppressions } from "../../src/db/schema";

async function runOnce() {
  const queued = await db.select().from(messages).where(eq(messages.status, "queued")).limit(500);
  for (const message of queued) {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, message.contactId)).limit(1);
    if (!contact || contact.status !== "active") {
      await db.update(messages).set({ status: "cancelled", lastError: "contact_not_active" }).where(eq(messages.id, message.id));
      continue;
    }

    const [suppressed] = await db.select({ id: suppressions.id, reason: suppressions.reason }).from(suppressions).where(eq(suppressions.normalizedEmail, contact.normalizedEmail)).limit(1);
    if (suppressed) {
      await db.update(messages).set({ status: "cancelled", lastError: `suppressed:${suppressed.reason}` }).where(eq(messages.id, message.id));
      continue;
    }

    if (contact.validationStatus === "invalid") {
      await db.update(messages).set({ status: "cancelled", lastError: "validation_invalid" }).where(eq(messages.id, message.id));
      continue;
    }

    await db.update(messages).set({ status: "ready_for_transport", lastError: null }).where(eq(messages.id, message.id));
  }
  console.log(`[policy-worker] evaluated ${queued.length} messages`);
}

runOnce().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => pool.end());
