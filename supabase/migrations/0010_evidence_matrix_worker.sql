-- ResearchAI Phase 6A.3: Evidence Matrix request queue + worker functions.
-- Additive to 0001-0009 (untouched, apart from replacing ONE function, below).
-- Run once in the Supabase SQL editor. Requires PostgreSQL 15+ (as 0009).
--
-- QUEUE BOUNDARY: a paper is extracted ONLY after a user requested it. A request is a
-- paper_extractions row in status 'pending'. Nothing scans ready papers, and a ready
-- paper without a row is never processed.
--
--   browser  -> request_paper_extraction(paper_id)          authenticated, SECURITY DEFINER
--   worker   -> claim_next_paper_extraction(...)            service_role: picks a pending row
--            -> claim_paper_extraction (0009)               fenced claim + generation reset
--            -> store_extraction_field (0009) x7            fenced writes
--            -> complete_paper_extraction (replaced here)   or
--            -> retry_paper_extraction / fail_paper_extraction (0009)
--
-- WHAT THIS ADDS
--   request_paper_extraction       the ONLY browser entry point (caller = auth.uid())
--   claim_next_paper_extraction    worker discovery over requested (pending) rows
--   retry_paper_extraction         fenced "put back in the queue" for transient failures
--   complete_paper_extraction      REPLACED (same signature): provider/model may be NULL,
--                                  but only when no LLM ran (every field not_reported)
begin;

-- Browser request ---------------------------------------------------------------------
-- Takes ONLY the paper id. The owner comes from auth.uid(); schema version 1 is fixed
-- here; the generation is read from papers. Nothing else is caller-controlled.
--
-- Returns: 'requested'   the extraction is now pending (new, retry, or regeneration)
--          'unchanged'   already pending/running, or complete for the current generation
--          'not_ready'   an owned paper that is not ready / has no generation yet
--          'not_found'   no such paper OR not owned by the caller (indistinguishable)
--
-- Regeneration does not delete anything: an older generation's fields/sources stay
-- until the worker's claim_paper_extraction resets them.
--
-- CONCURRENCY: two simultaneous requests are safe. INSERT ... ON CONFLICT DO NOTHING
-- waits for a concurrent insert and then does nothing (no unique violation); the row
-- is then locked FOR UPDATE and the loser sees the winner's pending row: 'unchanged'.
-- The paper is read FOR KEY SHARE so it cannot be deleted between the check and the insert.
--
-- ATTEMPT BUDGET: 'attempts' counts claims for the CURRENT request and generation.
-- It starts at 0 when a row is created or deliberately re-requested (failed / partial /
-- older generation), and claim_paper_extraction also resets it on a generation change.
-- Nothing else resets it: worker retries keep counting, and requesting a pending,
-- running or current-complete extraction is a no-op, so no automatic loop can refresh
-- its own budget.
create or replace function public.request_paper_extraction(p_paper_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_generation timestamptz;
  v_inserted int;
  e_status text;
  e_generation timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select p.status, p.processing_completed_at
    into v_status, v_generation
    from public.papers p
   where p.id = p_paper_id and p.user_id = v_uid
     for key share;
  if not found then
    return 'not_found';
  end if;
  if v_status <> 'ready' or v_generation is null then
    return 'not_ready';
  end if;

  insert into public.paper_extractions (paper_id, schema_version, user_id, source_completed_at)
  values (p_paper_id, 1, v_uid, v_generation)
  on conflict (paper_id, schema_version) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return 'requested';
  end if;

  select e.status, e.source_completed_at
    into e_status, e_generation
    from public.paper_extractions e
   where e.paper_id = p_paper_id and e.schema_version = 1 and e.user_id = v_uid
     for update;
  if not found then
    return 'not_found';
  end if;

  -- Complete for the CURRENT generation, or already queued/running for it: no-op.
  if e_generation is not distinct from v_generation
     and e_status in ('pending', 'running', 'complete') then
    return 'unchanged';
  end if;

  -- failed / partial (retry) or an older generation (regenerate, whatever its status):
  -- make it claimable again. source_completed_at is deliberately left alone, so the
  -- worker claim sees the mismatch and performs the generation reset itself.
  update public.paper_extractions e
     set status = 'pending',
         attempts = 0,
         claim_started_at = null,
         completed_at = null,
         last_error = null
   where e.paper_id = p_paper_id and e.schema_version = 1;
  return 'requested';
end;
$$;

-- Worker discovery --------------------------------------------------------------------
-- Picks ONE requested extraction and claims it through claim_paper_extraction (0009),
-- which keeps the claim token, the generation reset and the attempts counter.
--   - only 'pending' rows (requests) and abandoned 'running' rows are considered
--   - the paper must currently be ready (a paper being reprocessed waits, and does not
--     block other work)
--   - an abandoned run that already used p_max_attempts is failed, not reclaimed
create or replace function public.claim_next_paper_extraction(
  p_schema_version int,
  p_max_attempts int default 3,
  p_stale_after interval default interval '15 minutes'
)
returns table (
  paper_id uuid,
  user_id uuid,
  schema_version int,
  source_completed_at timestamptz,
  claim_started_at timestamptz,
  attempts int
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_paper uuid;
begin
  if p_max_attempts is null or p_max_attempts not between 1 and 10 then
    raise exception 'invalid max attempts';
  end if;

  update public.paper_extractions e
     set status = 'failed',
         claim_started_at = null,
         completed_at = null,
         last_error = 'Extraction was abandoned after the maximum number of attempts.'
   where e.schema_version = p_schema_version
     and e.status = 'running'
     and e.updated_at < now() - p_stale_after
     and e.attempts >= p_max_attempts;

  select e.paper_id
    into v_paper
    from public.paper_extractions e
    join public.papers p on p.id = e.paper_id
   where e.schema_version = p_schema_version
     and p.status = 'ready'
     and p.processing_completed_at is not null
     and (
       e.status = 'pending'
       or (e.status = 'running'
           and e.updated_at < now() - p_stale_after
           and e.attempts < p_max_attempts)
     )
   order by e.updated_at, e.paper_id
   limit 1
     for update of e skip locked;
  if not found then
    return;
  end if;

  return query
  select c.paper_id, c.user_id, c.schema_version, c.source_completed_at,
         c.claim_started_at, c.attempts
    from public.claim_paper_extraction(v_paper, p_schema_version, p_stale_after) c;
end;
$$;

-- Fenced re-queue ---------------------------------------------------------------------
-- For a transient failure with attempts left, or when the paper's generation changed
-- while running. Only the holder of the current claim token can do it. Fields already
-- stored are kept (a retry resumes; a new generation is reset by the next claim).
-- Returns false when the claim no longer holds.
create or replace function public.retry_paper_extraction(
  p_paper_id uuid,
  p_schema_version int,
  p_claim_started_at timestamptz
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform 1
     from public.paper_extractions e
    where e.paper_id = p_paper_id
      and e.schema_version = p_schema_version
      and e.status = 'running'
      and e.claim_started_at = p_claim_started_at
      for update;
  if not found then
    return false;
  end if;

  update public.paper_extractions e
     set status = 'pending',
         claim_started_at = null,
         completed_at = null,
         last_error = null
   where e.paper_id = p_paper_id and e.schema_version = p_schema_version;
  return true;
end;
$$;

-- complete_paper_extraction: provider/model may be NULL only when no LLM ran -----------
-- Same signature as 0009 (CREATE OR REPLACE keeps grants; they are re-stated below).
-- Rules:
--   * p_provider and p_model are both NULL (no LLM ran) or both non-blank strings
--     (an LLM ran). One NULL, or a blank/whitespace value, is refused.
--   * NULL/NULL requires ALL SEVEN fields stored, every one 'not_reported': anything
--     extracted, failed or missing must name the provider and model that produced it.
--   * 'complete' additionally requires all seven fields to have been stored by THIS
--     claim (created_at >= the claim token). Fields left over from an earlier run can
--     never turn a run that did not rewrite them into a 'complete' extraction: it ends
--     'partial'. store_extraction_field deletes and re-inserts a field, so every field
--     written by this run has a created_at later than the claim.
--   * fencing (token, ready paper, generation) is unchanged
create or replace function public.complete_paper_extraction(
  p_paper_id uuid,
  p_schema_version int,
  p_claim_started_at timestamptz,
  p_provider text,
  p_model text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_fields int;
  v_failed int;
  v_extracted int;
  v_this_run int;
  v_provider text;
  v_model text;
  v_status text;
begin
  if (p_provider is null) <> (p_model is null) then
    raise exception 'provider and model must be given together';
  end if;
  if p_provider is not null then
    if p_provider !~ '\S' or p_model !~ '\S' then
      raise exception 'provider and model must not be blank';
    end if;
    v_provider := left(btrim(p_provider, E' \t\r\n'), 100);
    v_model := left(btrim(p_model, E' \t\r\n'), 200);
  end if;

  perform 1
     from public.paper_extractions e
     join public.papers p on p.id = e.paper_id
    where e.paper_id = p_paper_id
      and e.schema_version = p_schema_version
      and e.status = 'running'
      and e.claim_started_at = p_claim_started_at
      and p.status = 'ready'
      and e.source_completed_at = p.processing_completed_at
      for update of e;
  if not found then
    return null;
  end if;

  select count(*)::int,
         count(*) filter (where f.state = 'failed')::int,
         count(*) filter (where f.state = 'extracted')::int,
         count(*) filter (where f.created_at >= p_claim_started_at)::int
    into v_fields, v_failed, v_extracted, v_this_run
    from public.paper_extraction_fields f
   where f.paper_id = p_paper_id and f.schema_version = p_schema_version;
  if v_fields = 0 then
    raise exception 'cannot complete an extraction with no stored fields';
  end if;
  if v_provider is null and (v_fields <> 7 or v_failed > 0 or v_extracted > 0) then
    raise exception 'a NULL provider requires all seven fields stored as not_reported';
  end if;

  v_status := case when v_fields = 7 and v_failed = 0 and v_this_run = 7
                   then 'complete' else 'partial' end;

  update public.paper_extractions e
     set status = v_status,
         claim_started_at = null,
         completed_at = now(),
         provider = v_provider,
         model = v_model,
         last_error = null
   where e.paper_id = p_paper_id and e.schema_version = p_schema_version;

  return v_status;
end;
$$;

-- Privileges --------------------------------------------------------------------------
revoke all on function public.request_paper_extraction(uuid)
  from public, anon, authenticated;
revoke all on function public.claim_next_paper_extraction(int, int, interval)
  from public, anon, authenticated;
revoke all on function public.retry_paper_extraction(uuid, int, timestamptz)
  from public, anon, authenticated;
revoke all on function public.complete_paper_extraction(uuid, int, timestamptz, text, text)
  from public, anon, authenticated;

-- Browsers may call ONLY the request function.
grant execute on function public.request_paper_extraction(uuid) to authenticated;

grant execute on function public.claim_next_paper_extraction(int, int, interval) to service_role;
grant execute on function public.retry_paper_extraction(uuid, int, timestamptz) to service_role;
grant execute on function public.complete_paper_extraction(uuid, int, timestamptz, text, text) to service_role;

commit;
