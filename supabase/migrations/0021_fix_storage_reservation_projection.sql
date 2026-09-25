-- Fix the runtime ambiguity in reserve_storage_upload without rewriting the
-- already-applied 0018 migration. RETURNS TABLE creates PL/pgSQL variables for
-- every output column, so storage_capacity_config.capacity_bytes must be
-- qualified explicitly.
begin;

create or replace function public.reserve_storage_upload(p_bytes bigint)
returns table (
  allowed boolean,
  reservation_id uuid,
  used_bytes bigint,
  capacity_bytes bigint,
  remaining_bytes bigint
)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_capacity bigint;
  v_max_file bigint;
  v_used bigint;
  v_id uuid;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if p_bytes is null or p_bytes <= 0 then raise exception 'invalid_file_size'; end if;

  select c.capacity_bytes, c.max_individual_file_bytes
    into v_capacity, v_max_file
    from public.storage_capacity_config c
   where c.config_key = 'default';

  if p_bytes > v_max_file then
    return query select false, null::uuid, 0::bigint, v_capacity, v_capacity;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  update public.storage_reservations
     set status = 'released'
   where user_id = v_uid
     and status = 'reserved'
     and expires_at <= now();

  select coalesce(sum(p.file_size_bytes), 0)
       + coalesce((
           select sum(r.bytes)
             from public.storage_reservations r
            where r.user_id = v_uid
              and r.status = 'reserved'
              and r.expires_at > now()
         ), 0)
    into v_used
    from public.papers p
   where p.user_id = v_uid
     and p.storage_path is not null;

  if v_used + p_bytes > v_capacity then
    return query
      select false, null::uuid, v_used, v_capacity,
             greatest(v_capacity - v_used, 0::bigint);
    return;
  end if;

  insert into public.storage_reservations(user_id, bytes)
  values (v_uid, p_bytes)
  returning id into v_id;

  return query
    select true, v_id, v_used, v_capacity, v_capacity - v_used - p_bytes;
end;
$$;

revoke all on function public.reserve_storage_upload(bigint)
  from public, anon, authenticated;
grant execute on function public.reserve_storage_upload(bigint)
  to authenticated;

commit;
