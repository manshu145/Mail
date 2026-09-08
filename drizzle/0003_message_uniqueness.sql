CREATE UNIQUE INDEX IF NOT EXISTS "messages_campaign_contact_uidx" ON "messages" ("campaign_id", "contact_id");
