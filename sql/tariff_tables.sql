create extension if not exists pgcrypto;

create table if not exists approved_sources (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  name text not null,
  url text not null unique,
  parser_type text default 'html',
  active boolean not null default true,
  last_checked_at timestamptz,
  last_status text,
  last_hash text,
  created_at timestamptz not null default now()
);

create table if not exists tariff_source_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references approved_sources(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  content_hash text,
  raw_text text,
  source_url text,
  content_type text,
  changed boolean not null default false,
  error_message text
);

create table if not exists tariff_versions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  source_id uuid not null references approved_sources(id) on delete cascade,
  snapshot_id uuid not null references tariff_source_snapshots(id) on delete cascade,
  version_label text not null,
  status text not null default 'pending_review',
  created_at timestamptz not null default now()
);
