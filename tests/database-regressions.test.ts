import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { audienceSelection } from "../src/lib/audience";
import { handlePostfixEvent, type EventDb } from "../src/lib/postfix-events";
import { controlCampaign } from "../src/lib/campaign-control";
import { engagementSegmentDefinitions, segmentDefinitions } from "../src/db/segment-schema";
import { engagementAudienceSql } from "../src/lib/engagement-audience";
import { lists } from "../src/db/schema";

// Execute the actual production migrations and query text against PostgreSQL.
test("migrated database: analytics, SQL audiences, and atomic Postfix recovery", async () => {
  const pg = new PGlite();
  try {
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    for (const entry of journal.entries) await pg.exec(await readFile(`drizzle/${entry.tag}.sql`, "utf8"));
    for (const file of ["src/app/reports/page.tsx", "src/lib/campaign-reporting.ts"]) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/db.execute\(sql`([\s\S]*?)`\)/g)) {
        const query = match[1].replaceAll('${humanEvent}', "coalesce((payload->>'automated')::boolean,false)=false")
          .replaceAll('${campaignId}', "'00000000-0000-0000-0000-000000000000'").replaceAll('${limit}', "30");
        await pg.query(query);
      }
    }
    const orm = drizzle(pg);
    const [list] = await orm.insert(lists).values({ name: "Regression audience" }).returning();
    await pg.exec(`insert into contacts(email,normalized_email,consent_status,consent_source,validation_status) values
      ('good@example.com','good@example.com','confirmed','form','accepted'),
      ('blocked@example.com','blocked@example.com','confirmed','form','valid'),
      ('invalid@example.com','invalid@example.com','confirmed','form','invalid'),
      ('unconfirmed@example.com','unconfirmed@example.com','unconfirmed',null,'valid');
      insert into suppressions(email,normalized_email,reason,source) values('blocked@example.com','blocked@example.com','unsubscribe','test');`);
    await pg.query("insert into contact_lists(contact_id,list_id) select id,$1::uuid from contacts", [list.id]);
    const selection = await audienceSelection(list, orm as unknown as Parameters<typeof audienceSelection>[1]);
    const result = await orm.execute(sql`select * from (${selection}) a where not suppressed and validation_status<>'invalid'`);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].email, "good@example.com");
    await pg.exec("insert into campaigns(name,subject,status) values('test','test','sending')");
    await orm.execute(sql`insert into messages(campaign_id,contact_id,recipient_email,status)
      select (select id from campaigns limit 1),contact_id,email,'queued'::message_status from (${selection}) a
      where not suppressed and validation_status<>'invalid' on conflict(campaign_id,contact_id) do nothing`);
    const connectionPool = { connect: async () => ({
      query: async (query: string, params?: unknown[]) => { const result = await pg.query(query, params); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; },
      release() {},
    }) } as unknown as NonNullable<Parameters<typeof controlCampaign>[2]>;
    const campaignId = (await pg.query<{id:string}>("select id from campaigns")).rows[0].id;
    await pg.exec("update messages set status='failed'; update campaigns set status='completed'");
    assert.equal((await controlCampaign(campaignId, "retry_failed", connectionPool)).status, "sending");
    await controlCampaign(campaignId, "pause", connectionPool);
    await pg.exec("update messages set status='failed'");
    assert.equal((await controlCampaign(campaignId, "retry_failed", connectionPool)).status, "paused");
    await controlCampaign(campaignId, "resume", connectionPool);
    await pg.exec("update messages set status='failed',last_error='transport_submission_uncertain'");
    await assert.rejects(controlCampaign(campaignId, "retry_failed", connectionPool), /No safely retryable/);
    const message = (await pg.query<{id:string}>("select id from messages")).rows[0];
    await pg.query("update messages set status='sending' where id=$1", [message.id]);
    const sent = "postfix/smtp[2]: ABC123: to=<good@example.com>, dsn=2.0.0, status=sent (OK)";
    assert.equal(await orm.transaction(tx => handlePostfixEvent(tx as unknown as EventDb, sent, message.id)), false, "wait for active transport to release its claim");
    await pg.query("update messages set status='failed',last_error='transport_submission_uncertain' where id=$1", [message.id]);
    // A failed transaction must roll back state, internal event, and webhook together.
    await assert.rejects(orm.transaction(async tx => {
      await handlePostfixEvent(tx as unknown as EventDb, sent, message.id);
      throw new Error("simulated interruption");
    }));
    assert.equal((await pg.query<{status:string}>("select status from messages")).rows[0].status, "failed");
    assert.equal((await pg.query("select * from webhook_events")).rows.length, 0);
    await orm.transaction(tx => handlePostfixEvent(tx as unknown as EventDb, sent, message.id));
    await orm.transaction(tx => handlePostfixEvent(tx as unknown as EventDb, sent, message.id));
    await orm.transaction(tx => handlePostfixEvent(tx as unknown as EventDb, sent.replace("status=sent", "status=deferred"), message.id));
    assert.equal((await pg.query<{status:string}>("select status from messages")).rows[0].status, "delivered");
    assert.equal((await pg.query("select * from message_events")).rows.length, 1);
    assert.equal((await pg.query("select * from webhook_events")).rows.length, 1);
    const [dynamic] = await orm.insert(lists).values({ name: "Dynamic", isDynamic: true }).returning();
    await orm.insert(segmentDefinitions).values({ listId: dynamic.id, field: "validation_status", operator: "equals", value: "accepted" });
    const dynamicSql = await audienceSelection(dynamic, orm as unknown as Parameters<typeof audienceSelection>[1]);
    assert.equal((await orm.execute(dynamicSql)).rows.length, 1);
    const [followup] = await orm.insert(lists).values({ name: "Followup", isDynamic: true }).returning();
    await orm.insert(engagementSegmentDefinitions).values({ listId: followup.id, campaignId, ruleType: "not_opened", windowDays: 30 });
    const followupSql = await audienceSelection(followup, orm as unknown as Parameters<typeof audienceSelection>[1]);
    assert.equal((await orm.execute(followupSql)).rows.length, 1);
    await pg.query("insert into message_events(message_id,type,payload) values($1,'open','{\"automated\":true}')", [message.id]);
    assert.equal((await orm.execute(engagementAudienceSql(campaignId, "not_opened", 30))).rows.length, 1);
    await pg.query("insert into message_events(message_id,type,payload) values($1,'open','{\"automated\":false}')", [message.id]);
    assert.equal((await orm.execute(engagementAudienceSql(campaignId, "not_opened", 30))).rows.length, 0);
    assert.equal((await orm.execute(engagementAudienceSql(campaignId, "opened", 30))).rows.length, 1);
    await controlCampaign(campaignId, "cancel", connectionPool);
    await assert.rejects(controlCampaign(campaignId, "retry_failed", connectionPool), /Cancelled/);

  } finally { await pg.close(); }
});
