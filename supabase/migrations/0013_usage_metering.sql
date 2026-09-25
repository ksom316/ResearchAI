-- ResearchAI R9: trusted, append-only usage metering.
-- This records measurement only. There are no plans, payments, quotas or limits.
begin;

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.research_projects (id) on delete set null,
  feature text not null check (feature in (
    'research_chat', 'academic_writer', 'claim_checker', 'evidence_matrix',
    'research_gaps', 'semantic_search', 'paper_processing', 'embedding_indexing'
  )),
  event_type text not null check (event_type in (
    'llm_request', 'paper_processed', 'embedding_request'
  )),
  provider text,
  model text,
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  total_tokens bigint check (total_tokens is null or total_tokens >= 0),
  quantity bigint not null default 1 check (quantity >= 0),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index usage_events_actor_created_idx
  on public.usage_events (actor_user_id, created_at);
create index usage_events_actor_feature_idx
  on public.usage_events (actor_user_id, feature, created_at);

alter table public.usage_events enable row level security;

-- The browser may read only its own rows. There is deliberately no browser write
-- policy or table grant: authoritative writes use the service-role client only.
create policy "Users read own usage events" on public.usage_events
  for select to authenticated
  using (actor_user_id = (select auth.uid()));

revoke all on public.usage_events from anon, authenticated;
grant select (
  id, actor_user_id, project_id, feature, event_type, provider, model,
  input_tokens, output_tokens, total_tokens, quantity, metadata, created_at
) on public.usage_events to authenticated;
grant select, insert, update, delete on public.usage_events to service_role;

-- Read-only summary RPC. It has no user id parameter: ownership comes from auth.uid().
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
  select e.*
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

-- Replace the processing completion function so successful processing and its event
-- are one fenced transaction. Replays are harmless because the event key is unique.
create or replace function public.complete_paper_processing(
  p_paper_id uuid,
  p_started_at timestamptz,
  p_page_count int,
  p_sections jsonb,
  p_chunks jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  select p.user_id
    into v_user_id
    from public.papers p
   where p.id = p_paper_id
     and p.status = 'processing'
     and p.processing_started_at = p_started_at
     for update;
  if not found then
    return false;
  end if;

  delete from public.paper_sections s where s.paper_id = p_paper_id;

  insert into public.paper_sections
    (id, paper_id, user_id, "position", title, section_type, page_start, page_end, text)
  select x.id, p_paper_id, v_user_id, x."position", x.title, x.section_type,
         x.page_start, x.page_end, x.text
    from jsonb_to_recordset(coalesce(p_sections, '[]'::jsonb)) as x(
      id uuid, "position" int, title text, section_type text,
      page_start int, page_end int, text text
    );

  insert into public.paper_chunks
    (id, paper_id, user_id, section_id, chunk_index, text,
     char_start, char_end, page_start, page_end)
  select x.id, p_paper_id, v_user_id, x.section_id, x.chunk_index, x.text,
         x.char_start, x.char_end, x.page_start, x.page_end
    from jsonb_to_recordset(coalesce(p_chunks, '[]'::jsonb)) as x(
      id uuid, section_id uuid, chunk_index int, text text,
      char_start int, char_end int, page_start int, page_end int
    );

  update public.papers p
     set status = 'ready',
         processing_completed_at = now(),
         processing_error = null,
         page_count = p_page_count
   where p.id = p_paper_id;

  insert into public.usage_events (
    actor_user_id, project_id, feature, event_type, quantity, idempotency_key, metadata
  ) values (
    v_user_id, null, 'paper_processing', 'paper_processed', 1,
    p_paper_id::text || ':paper_processed:' || p_started_at::text,
    jsonb_build_object('page_count', p_page_count)
  ) on conflict (idempotency_key) do nothing;

  return true;
end;
$$;

revoke all on function public.complete_paper_processing(uuid, timestamptz, int, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_paper_processing(uuid, timestamptz, int, jsonb, jsonb)
  to service_role;

commit;
