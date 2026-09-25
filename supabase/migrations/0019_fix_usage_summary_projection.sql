-- Keep the authenticated usage summary on its intentionally narrow column grants.
-- The original CTE selected e.*, which also required access to idempotency_key even
-- though the summary never reads or returns that internal value.
begin;

create or replace function public.get_my_usage_summary(
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns table (
  ai_requests bigint,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  papers_processed bigint,
  paper_pages bigint,
  embedding_chunks bigint,
  embedding_requests bigint,
  embedding_tokens bigint,
  storage_bytes bigint,
  feature_breakdown jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
with events as (
  select
    e.feature,
    e.event_type,
    e.input_tokens,
    e.output_tokens,
    e.total_tokens,
    e.quantity,
    e.metadata
    from public.usage_events e
   where e.actor_user_id = (select auth.uid())
     and e.created_at >= p_period_start
     and e.created_at < p_period_end
),
feature_counts as (
  select e.feature, count(*)::bigint as requests
    from events e
   where e.event_type = 'llm_request'
   group by e.feature
)
select
  count(*) filter (where e.event_type = 'llm_request')::bigint,
  case when count(*) filter (where e.event_type = 'llm_request') =
             count(e.input_tokens) filter (where e.event_type = 'llm_request')
       then coalesce(sum(e.input_tokens) filter (where e.event_type = 'llm_request'), 0)::bigint
       else null end,
  case when count(*) filter (where e.event_type = 'llm_request') =
             count(e.output_tokens) filter (where e.event_type = 'llm_request')
       then coalesce(sum(e.output_tokens) filter (where e.event_type = 'llm_request'), 0)::bigint
       else null end,
  case when count(*) filter (where e.event_type = 'llm_request') =
             count(e.total_tokens) filter (where e.event_type = 'llm_request')
       then coalesce(sum(e.total_tokens) filter (where e.event_type = 'llm_request'), 0)::bigint
       else null end,
  coalesce(count(*) filter (where e.event_type = 'paper_processed'), 0)::bigint,
  case when count(*) filter (where e.event_type = 'paper_processed') =
             count(*) filter (where e.event_type = 'paper_processed'
                               and (e.metadata ->> 'page_count') ~ '^[0-9]+$')
       then coalesce(sum((e.metadata ->> 'page_count')::bigint)
                     filter (where e.event_type = 'paper_processed'), 0)::bigint
       else null end,
  coalesce(sum(e.quantity) filter (
    where e.event_type = 'embedding_request' and e.feature = 'embedding_indexing'
  ), 0)::bigint,
  coalesce(count(*) filter (where e.event_type = 'embedding_request'), 0)::bigint,
  case when count(*) filter (where e.event_type = 'embedding_request') =
             count(e.total_tokens) filter (where e.event_type = 'embedding_request')
       then coalesce(sum(e.total_tokens) filter (where e.event_type = 'embedding_request'), 0)::bigint
       else null end,
  (select case when count(*) = count(p.file_size_bytes)
               then coalesce(sum(p.file_size_bytes), 0)::bigint
               else null end
     from public.papers p
    where p.user_id = (select auth.uid())
      and p.storage_path is not null),
  coalesce((select jsonb_object_agg(fc.feature, fc.requests) from feature_counts fc), '{}'::jsonb)
from events e;
$$;

revoke all on function public.get_my_usage_summary(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.get_my_usage_summary(timestamptz, timestamptz)
  to authenticated, service_role;

commit;
