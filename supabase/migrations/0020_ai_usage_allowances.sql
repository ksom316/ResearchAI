-- R11: configurable monthly AI allowances. Storage capacity remains independent.
begin;

create table public.ai_allowance_profiles (
  profile_key text primary key,
  request_limit bigint not null check (request_limit > 0),
  token_limit bigint not null check (token_limit > 0),
  updated_at timestamptz not null default now()
);

insert into public.ai_allowance_profiles (profile_key, request_limit, token_limit)
values ('default', 100, 250000);

create table public.user_ai_allowance_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile_key text not null references public.ai_allowance_profiles(profile_key),
  updated_at timestamptz not null default now()
);

alter table public.ai_allowance_profiles enable row level security;
alter table public.user_ai_allowance_profiles enable row level security;
revoke all on public.ai_allowance_profiles from public, anon, authenticated;
revoke all on public.user_ai_allowance_profiles from public, anon, authenticated;
grant select, insert, update, delete on public.ai_allowance_profiles to service_role;
grant select, insert, update, delete on public.user_ai_allowance_profiles to service_role;

create or replace function public.get_ai_allowance_for_actor(p_actor_user_id uuid)
returns table (
  period_start timestamptz,
  period_end timestamptz,
  requests_used bigint,
  request_limit bigint,
  requests_remaining bigint,
  tokens_used bigint,
  token_limit bigint,
  tokens_remaining bigint,
  request_percent int,
  token_percent int,
  percentage_used int,
  allowed boolean,
  exhausted_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
with period as (
  select
    date_trunc('month', now() at time zone 'UTC') at time zone 'UTC' as starts_at,
    (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC' as ends_at
),
profile as (
  select p.request_limit, p.token_limit
    from public.ai_allowance_profiles p
   where p.profile_key = coalesce(
     (select u.profile_key
        from public.user_ai_allowance_profiles u
       where u.user_id = p_actor_user_id),
     'default'
   )
),
usage as (
  select
    count(*) filter (
      where e.event_type = 'llm_request'
        and e.metadata ->> 'outcome' = 'success'
    )::bigint as requests_used,
    coalesce(sum(e.total_tokens) filter (
      where e.event_type = 'llm_request' and e.total_tokens is not null
    ), 0)::bigint as tokens_used
    from public.usage_events e
    cross join period d
   where e.actor_user_id = p_actor_user_id
     and e.created_at >= d.starts_at
     and e.created_at < d.ends_at
),
summary as (
  select
    d.starts_at,
    d.ends_at,
    u.requests_used,
    p.request_limit,
    greatest(p.request_limit - u.requests_used, 0)::bigint as requests_remaining,
    u.tokens_used,
    p.token_limit,
    greatest(p.token_limit - u.tokens_used, 0)::bigint as tokens_remaining,
    least(100, floor(u.requests_used * 100.0 / p.request_limit)::int) as request_percent,
    least(100, floor(u.tokens_used * 100.0 / p.token_limit)::int) as token_percent
  from period d cross join profile p cross join usage u
)
select
  s.starts_at,
  s.ends_at,
  s.requests_used,
  s.request_limit,
  s.requests_remaining,
  s.tokens_used,
  s.token_limit,
  s.tokens_remaining,
  s.request_percent,
  s.token_percent,
  greatest(s.request_percent, s.token_percent),
  s.requests_used < s.request_limit and s.tokens_used < s.token_limit,
  case
    when s.requests_used >= s.request_limit then 'requests'
    when s.tokens_used >= s.token_limit then 'tokens'
    else null
  end
from summary s;
$$;

revoke all on function public.get_ai_allowance_for_actor(uuid)
  from public, anon, authenticated;
grant execute on function public.get_ai_allowance_for_actor(uuid)
  to service_role;

create or replace function public.get_my_ai_allowance()
returns table (
  period_start timestamptz,
  period_end timestamptz,
  requests_used bigint,
  request_limit bigint,
  requests_remaining bigint,
  tokens_used bigint,
  token_limit bigint,
  tokens_remaining bigint,
  request_percent int,
  token_percent int,
  percentage_used int,
  allowed boolean,
  exhausted_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  return query select * from public.get_ai_allowance_for_actor(auth.uid());
end;
$$;

revoke all on function public.get_my_ai_allowance() from public, anon;
grant execute on function public.get_my_ai_allowance()
  to authenticated, service_role;

commit;
