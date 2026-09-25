alter table "campaigns" add column if not exists "validation_policy" text not null default 'standard';
