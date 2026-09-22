alter table campaign_preflights
  add column if not exists status text not null default 'warning',
  add column if not exists checks jsonb not null default '[]'::jsonb,
  add column if not exists blocking_issues jsonb not null default '[]'::jsonb;

create index if not exists campaign_preflights_status_idx
  on campaign_preflights(status,checked_at desc);
