-- ResearchAI Phase 3B: server-side job claiming and atomic result persistence for
-- the PDF processing worker. Additive to 0001-0004 (untouched).
-- Run once in the Supabase SQL editor.
--
-- All three functions are callable ONLY by the service role (the worker). Browser
-- roles (anon, authenticated) have no EXECUTE privilege on them.
begin;

alter table public.papers
  add column processing_attempts int not null default 0
    check (processing_attempts >= 0);

-- Claim ----------------------------------------------------------------------------
-- Atomically moves exactly one eligible paper to 'processing' and returns it.
-- Eligible: status 'uploaded', or status 'processing' but abandoned (its
-- processing_started_at is older than p_stale_after, i.e. the worker crashed),
-- and attempts still below p_max_attempts.
-- Safe with concurrent workers: FOR UPDATE SKIP LOCKED means a second caller
-- skips a row another transaction has claimed instead of waiting or double-claiming.
create or replace function public.claim_next_paper(
  p_max_attempts int default 3,
  p_stale_after interval default interval '15 minutes'
)
returns table (
  id uuid,
  user_id uuid,
  storage_path text,
  processing_started_at timestamptz,
  processing_attempts int
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
begin
  -- Abandoned jobs that already used all their attempts are failed, not retried
  -- forever.
  update public.papers p
     set status = 'failed',
         processing_completed_at = now(),
         processing_error = 'Processing was interrupted repeatedly and was stopped.'
   where p.status = 'processing'
     and p.processing_started_at < now() - p_stale_after
     and p.processing_attempts >= p_max_attempts;

  return query
  with candidate as (
    select c.id
      from public.papers c
     where c.storage_path is not null
       and c.processing_attempts < p_max_attempts
       and (
         c.status = 'uploaded'
         or (c.status = 'processing'
             and c.processing_started_at < now() - p_stale_after)
       )
     order by c.created_at
     limit 1
       for update skip locked
  )
  update public.papers p
     set status = 'processing',
         processing_started_at = clock_timestamp(),
         processing_completed_at = null,
         processing_error = null,
         processing_attempts = p.processing_attempts + 1
    from candidate
   where p.id = candidate.id
  returning p.id, p.user_id, p.storage_path,
            p.processing_started_at, p.processing_attempts;
end;
$$;

-- Complete -------------------------------------------------------------------------
-- Replaces the paper's derived sections/chunks and marks it 'ready' in ONE
-- transaction (a function body is atomic). "Fenced" by p_started_at: if the claim
-- was lost (another worker reclaimed the paper after a stale timeout, or it is no
-- longer processing) nothing is written and false is returned.
-- user_id/paper_id are taken from the paper row, never from the payload.
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

  -- Idempotent on retry: old derived rows go first (chunks cascade).
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

  return true;
end;
$$;

-- Fail -----------------------------------------------------------------------------
-- Ends a job unsuccessfully, also fenced by p_started_at. p_retry = true puts the
-- paper back to 'uploaded' so it is claimed again (attempts are already counted);
-- otherwise it becomes 'failed' with a safe message. Derived rows are cleared so
-- no partial data survives either way.
create or replace function public.fail_paper_processing(
  p_paper_id uuid,
  p_started_at timestamptz,
  p_error text,
  p_retry boolean
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform 1
     from public.papers p
    where p.id = p_paper_id
      and p.status = 'processing'
      and p.processing_started_at = p_started_at
      for update;
  if not found then
    return false;
  end if;

  delete from public.paper_sections s where s.paper_id = p_paper_id;

  if p_retry then
    update public.papers p
       set status = 'uploaded',
           processing_started_at = null,
           processing_completed_at = null,
           processing_error = null
     where p.id = p_paper_id;
  else
    update public.papers p
       set status = 'failed',
           processing_completed_at = now(),
           processing_error = coalesce(left(p_error, 1000), 'Processing failed.')
     where p.id = p_paper_id;
  end if;

  return true;
end;
$$;

-- Service role only -----------------------------------------------------------------
revoke all on function public.claim_next_paper(int, interval)
  from public, anon, authenticated;
revoke all on function public.complete_paper_processing(uuid, timestamptz, int, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_paper_processing(uuid, timestamptz, text, boolean)
  from public, anon, authenticated;

grant execute on function public.claim_next_paper(int, interval) to service_role;
grant execute on function public.complete_paper_processing(uuid, timestamptz, int, jsonb, jsonb) to service_role;
grant execute on function public.fail_paper_processing(uuid, timestamptz, text, boolean) to service_role;

commit;
