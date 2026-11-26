begin;

create table if not exists public.demo_tariff_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  used_at timestamptz,
  reservation_id uuid,
  reserved_until timestamptz,
  check ((reservation_id is null) = (reserved_until is null)),
  check (used_at is null or reservation_id is null)
);

alter table public.demo_tariff_usage enable row level security;

revoke all on public.demo_tariff_usage
  from public, anon, authenticated;

grant select on public.demo_tariff_usage to authenticated;
grant all on public.demo_tariff_usage to service_role;

drop policy if exists demo_tariff_usage_read_self
  on public.demo_tariff_usage;

create policy demo_tariff_usage_read_self
on public.demo_tariff_usage
for select to authenticated
using (user_id = (select auth.uid()));

-- Existing demo accounts with saved analyses have used their allowance.
insert into public.demo_tariff_usage (user_id, used_at)
select a.user_id, now()
from public.account_access a
where a.access_level = 'demo'
  and exists (
    select 1 from public.tariff_analyses t
    where t.user_id = a.user_id
  )
on conflict (user_id) do nothing;

create or replace function public.reserve_demo_tariff(
  p_user_id uuid,
  p_reservation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage public.demo_tariff_usage%rowtype;
begin
  if p_reservation_id is null or not exists (
    select 1 from public.account_access
    where user_id = p_user_id and access_level = 'demo'
  ) then
    raise exception 'Invalid demo account';
  end if;

  insert into public.demo_tariff_usage (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_usage
  from public.demo_tariff_usage
  where user_id = p_user_id
  for update;

  if v_usage.used_at is not null then
    return jsonb_build_object('status', 'used');
  end if;

  if exists (
    select 1 from public.tariff_analyses
    where user_id = p_user_id
  ) then
    update public.demo_tariff_usage
    set used_at = now(),
        reservation_id = null,
        reserved_until = null
    where user_id = p_user_id;

    return jsonb_build_object('status', 'used');
  end if;

  if v_usage.reserved_until > now() then
    return jsonb_build_object('status', 'busy');
  end if;

  update public.demo_tariff_usage
  set reservation_id = p_reservation_id,
      reserved_until = now() + interval '10 minutes'
  where user_id = p_user_id;

  return jsonb_build_object('status', 'reserved');
end;
$$;

create or replace function public.complete_demo_tariff(
  p_user_id uuid,
  p_reservation_id uuid,
  p_country text,
  p_file_name text,
  p_result jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usage public.demo_tariff_usage%rowtype;
begin
  select * into v_usage
  from public.demo_tariff_usage
  where user_id = p_user_id
  for update;

  if not found
    or v_usage.used_at is not null
    or v_usage.reservation_id is distinct from p_reservation_id
    or v_usage.reserved_until is null
    or v_usage.reserved_until <= now() then
    raise exception 'Reservation is no longer valid';
  end if;

  insert into public.tariff_analyses
    (id, user_id, country_code, file_name, result)
  values
    (p_reservation_id, p_user_id, p_country, p_file_name, p_result);

  update public.demo_tariff_usage
  set used_at = now(),
      reservation_id = null,
      reserved_until = null
  where user_id = p_user_id;

  return jsonb_build_object('analysis_id', p_reservation_id);
end;
$$;

create or replace function public.release_demo_tariff(
  p_user_id uuid,
  p_reservation_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.demo_tariff_usage
  set reservation_id = null,
      reserved_until = null
  where user_id = p_user_id
    and reservation_id = p_reservation_id
    and used_at is null;
end;
$$;

revoke all on function public.reserve_demo_tariff(uuid, uuid)
  from public, anon, authenticated;

revoke all on function public.complete_demo_tariff(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated;

revoke all on function public.release_demo_tariff(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.reserve_demo_tariff(uuid, uuid)
  to service_role;

grant execute on function public.complete_demo_tariff(
  uuid, uuid, text, text, jsonb
) to service_role;

grant execute on function public.release_demo_tariff(uuid, uuid)
  to service_role;

commit;