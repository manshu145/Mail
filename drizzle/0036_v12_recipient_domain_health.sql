create table if not exists recipient_domain_health (
  domain text primary key,
  status text not null,
  mx_hosts jsonb not null default '[]'::jsonb,
  detail text,
  checked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipient_domain_health_status_checked_idx
  on recipient_domain_health(status,checked_at);
