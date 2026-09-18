alter table "campaign_preflights" add column if not exists "awaiting_validation_count" integer default 0 not null;
alter table "campaign_preflights" add column if not exists "validation_policy_version" integer default 1 not null;
