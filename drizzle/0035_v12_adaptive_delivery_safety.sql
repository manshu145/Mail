create table if not exists campaign_delivery_safety (
  campaign_id uuid primary key references campaigns(id) on delete cascade,
  phase integer not null default 0,
  release_limit integer not null default 0,
  state text not null default 'canary',
  sample_count integer not null default 0,
  bounced_count integer not null default 0,
  bounce_rate real not null default 0,
  reason text,
  updated_at timestamptz not null default now()
);

create index if not exists campaign_delivery_safety_state_idx
  on campaign_delivery_safety(state,updated_at);
