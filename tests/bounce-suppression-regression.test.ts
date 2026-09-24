import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { handlePostfixEvent, type EventDb } from "../src/lib/postfix-events";
import { suppressions, contacts, campaigns, messages } from "../src/db/schema";

async function migratedDb() {
  const pg = new PGlite();
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) await pg.exec(await readFile(`drizzle/${entry.tag}.sql`, "utf8"));
  return pg;
}

test("policy/reputation bounce does not suppress the recipient", async () => {
  const pg = await migratedDb();
  try {
    const orm = drizzle(pg);
    const accountId = "11111111-1111-1111-1111-111111111111";
    const campaignId = "22222222-2222-2222-2222-222222222222";
    const contactId = "33333333-3333-3333-3333-333333333333";
    await pg.exec(`
      insert into sending_accounts(id,name,from_name,from_email) values
        ('${accountId}','Test Sender','Test Sender','sender@example.com');
      insert into campaigns(id,name,subject,sending_account_id,status)
        values ('${campaignId}','Policy bounce test','Hello','${accountId}','sending');
      insert into contacts(id,email,normalized_email,consent_status,consent_source,validation_status)
        values ('${contactId}','policy@example.com','policy@example.com','confirmed','test','valid');
      insert into messages(id,campaign_id,contact_id,recipient_email,status,provider_message_id)
        values ('44444444-4444-4444-4444-444444444444','${campaignId}','${contactId}','policy@example.com','mta_accepted','QPOLICY');
    `);
    const line = "postfix/smtp[1]: QPOLICY: to=<policy@example.com>, dsn=5.7.1, status=bounced (host mx.example.com said: 550 5.7.1 rejected due to sender reputation)";
    await orm.transaction(tx => handlePostfixEvent(tx as unknown as EventDb, line, null));
    const rows = await orm.select().from(suppressions).where(eq(suppressions.normalizedEmail, "policy@example.com"));
    assert.equal(rows.length, 0);
    const message = await orm.select().from(messages).where(eq(messages.id, "44444444-4444-4444-4444-444444444444"));
    assert.equal(message[0].status, "bounced");
  } finally {
    await pg.close();
  }
});

test("confirmed recipient-not-found bounce creates a hard-bounce suppression", async () => {
  const pg = await migratedDb();
  try {
    const orm = drizzle(pg);
    const accountId = "55555555-5555-5555-5555-555555555555";
    const campaignId = "66666666-6666-6666-6666-666666666666";
    const contactId = "77777777-7777-7777-7777-777777777777";
    await pg.exec(`
      insert into sending_accounts(id,name,from_name,from_email) values
        ('${accountId}','Test Sender 2','Test Sender','sender2@example.com');
      insert into campaigns(id,name,subject,sending_account_id,status)
        values ('${campaignId}','Hard bounce test','Hello','${accountId}','sending');
      insert into contacts(id,email,normalized_email,consent_status,consent_source,validation_status)
        values ('${contactId}','missing@example.com','missing@example.com','confirmed','test','valid');
      insert into messages(id,campaign_id,contact_id,recipient_email,status,provider_message_id)
        values ('88888888-8888-8888-8888-888888888888','${campaignId}','${contactId}','missing@example.com','mta_accepted','QHARD');
    `);
    const line = "postfix/smtp[1]: QHARD: to=<missing@example.com>, dsn=5.1.1, status=bounced (host mx.example.com said: 550 5.1.1 user unknown)";
    await orm.transaction(tx => handlePostfixEvent(tx as unknown as EventDb, line, null));
    const rows = await orm.select().from(suppressions).where(eq(suppressions.normalizedEmail, "missing@example.com"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reason, "hard_bounce");
  } finally {
    await pg.close();
  }
});
