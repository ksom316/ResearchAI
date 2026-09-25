-- Storage capacity: one configurable pre-commercial default, no plan model.
begin;

create table public.storage_capacity_config (
  config_key text primary key check (config_key = 'default'),
  capacity_bytes bigint not null check (capacity_bytes > 0),
  max_individual_file_bytes bigint not null check (max_individual_file_bytes > 0),
  updated_at timestamptz not null default now()
);
insert into public.storage_capacity_config(config_key, capacity_bytes, max_individual_file_bytes)
values ('default', 209715200, 52428800)
on conflict (config_key) do nothing;
alter table public.storage_capacity_config enable row level security;
revoke all on public.storage_capacity_config from anon, authenticated;

create table public.storage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bytes bigint not null check (bytes > 0),
  status text not null default 'reserved' check (status in ('reserved', 'consumed', 'released')),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now()
);
create index storage_reservations_active_idx on public.storage_reservations(user_id, status, expires_at);
alter table public.storage_reservations enable row level security;
revoke all on public.storage_reservations from anon, authenticated;

alter table public.papers add column storage_reservation_id uuid references public.storage_reservations(id) on delete set null;
grant insert (storage_reservation_id) on public.papers to authenticated;

create or replace function public.reserve_storage_upload(p_bytes bigint)
returns table (allowed boolean, reservation_id uuid, used_bytes bigint, capacity_bytes bigint, remaining_bytes bigint)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_capacity bigint; v_max_file bigint; v_used bigint; v_id uuid;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if p_bytes is null or p_bytes <= 0 then raise exception 'invalid_file_size'; end if;
  select capacity_bytes, max_individual_file_bytes into v_capacity, v_max_file
    from public.storage_capacity_config where config_key = 'default';
  if p_bytes > v_max_file then
    return query select false, null::uuid, 0::bigint, v_capacity, v_capacity;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  update public.storage_reservations set status = 'released'
   where user_id = v_uid and status = 'reserved' and expires_at <= now();
  select coalesce(sum(p.file_size_bytes), 0) + coalesce((select sum(r.bytes) from public.storage_reservations r
          where r.user_id = v_uid and r.status = 'reserved' and r.expires_at > now()), 0)
    into v_used from public.papers p where p.user_id = v_uid and p.storage_path is not null;
  if v_used + p_bytes > v_capacity then
    return query select false, null::uuid, v_used, v_capacity, greatest(v_capacity - v_used, 0);
    return;
  end if;
  insert into public.storage_reservations(user_id, bytes) values (v_uid, p_bytes) returning id into v_id;
  return query select true, v_id, v_used, v_capacity, v_capacity - v_used - p_bytes;
end; $$;

create or replace function public.release_storage_reservation(p_reservation_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.storage_reservations set status = 'released'
   where id = p_reservation_id and user_id = auth.uid() and status = 'reserved'
$$;

create or replace function public.consume_storage_reservation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_res public.storage_reservations%rowtype;
begin
  if new.storage_path is null then return new; end if;
  if new.storage_reservation_id is null then raise exception 'storage_reservation_required'; end if;
  select * into v_res from public.storage_reservations where id = new.storage_reservation_id for update;
  if not found or v_res.user_id <> new.user_id or v_res.status <> 'reserved'
     or v_res.expires_at <= now() or v_res.bytes <> new.file_size_bytes then
    raise exception 'storage_reservation_invalid';
  end if;
  update public.storage_reservations set status = 'consumed' where id = v_res.id;
  return new;
end; $$;
drop trigger if exists papers_consume_storage_reservation on public.papers;
create trigger papers_consume_storage_reservation before insert on public.papers
for each row execute function public.consume_storage_reservation();

create or replace function public.get_my_storage_summary()
returns table (storage_bytes bigint, storage_capacity_bytes bigint, storage_remaining_bytes bigint, storage_percent int)
language sql stable security definer set search_path = '' as $$
with config as (select capacity_bytes from public.storage_capacity_config where config_key = 'default'),
used as (select coalesce(sum(file_size_bytes), 0)::bigint bytes from public.papers
          where user_id = auth.uid() and storage_path is not null)
select used.bytes, config.capacity_bytes, greatest(config.capacity_bytes - used.bytes, 0),
       least(100, floor(used.bytes * 100.0 / nullif(config.capacity_bytes, 0))::int)
from used cross join config;
$$;

revoke all on function public.reserve_storage_upload(bigint) from public, anon, authenticated;
grant execute on function public.reserve_storage_upload(bigint) to authenticated;
revoke all on function public.release_storage_reservation(uuid) from public, anon, authenticated;
grant execute on function public.release_storage_reservation(uuid) to authenticated;
revoke all on function public.get_my_storage_summary() from public, anon;
grant execute on function public.get_my_storage_summary() to authenticated, service_role;

commit;
