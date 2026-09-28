-- ITERAS: private saved customs analyses. Run once in Supabase SQL Editor.
-- This adds a separate table; existing diagnosis and tariff source tables are untouched.
-- No PDF file or file contents are stored. Only filename, country and analysis JSON.
begin;

create table public.tariff_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  country_code text not null check (country_code in ('MX','AR','BO','BR','CL','CO','EC','PY','PE','UY','VE')),
  file_name text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint tariff_analyses_result_object check (jsonb_typeof(result) = 'object'),
  constraint tariff_analyses_products_array check (result ? 'products' and jsonb_typeof(result->'products') = 'array'),
  constraint tariff_analyses_country_matches check (result ? 'country' and jsonb_typeof(result->'country') = 'string' and result->>'country' = country_code)
);

create index tariff_analyses_user_created_idx
  on public.tariff_analyses (user_id, created_at desc, id desc);

alter table public.tariff_analyses enable row level security;
revoke all on table public.tariff_analyses from public, anon, authenticated;
grant select, insert on table public.tariff_analyses to authenticated;

create policy tariff_analyses_select_own
  on public.tariff_analyses for select to authenticated
  using ((select auth.uid()) = user_id);

create policy tariff_analyses_insert_own
  on public.tariff_analyses for insert to authenticated
  with check ((select auth.uid()) = user_id);

commit;
