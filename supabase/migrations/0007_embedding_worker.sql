-- ResearchAI Phase 4C: service-role functions for the embedding (indexing) worker.
-- Additive to 0001-0006 (untouched). Run once in the Supabase SQL editor.
--
-- Four functions, callable ONLY by the service role (the worker):
--   claim_next_embedding_job   find + claim one job (creates/resets jobs as needed)
--   store_chunk_embeddings     persist one batch of vectors, fenced by the claim
--   complete_embedding_job     mark the job complete once every chunk is embedded
--   fail_embedding_job         end a claim: retry later, or fail with a safe message
--
-- Independent of PDF processing: papers.status and the PDF functions from 0005 are
-- never modified. A provider outage can only ever affect paper_embedding_jobs.
--
-- Generation rule: a job is current only when
--   paper_embedding_jobs.source_completed_at = papers.processing_completed_at
-- Reprocessing a paper changes its processing_completed_at (and cascade-deletes the
-- old vectors with the old chunks), so the claim function resets the job for the new
-- generation. Every worker write is fenced by claim_started_at, which that reset
-- clears, so a worker still holding the OLD generation can no longer store or
-- complete anything.
begin;

-- Earliest time a retried job may be claimed again (backoff between attempts).
-- Not granted to browsers: the column grant from 0006 lists columns explicitly.
alter table public.paper_embedding_jobs
  add column next_attempt_at timestamptz;

-- Claim ----------------------------------------------------------------------------
-- Works on the single ACTIVE embedding profile only. Housekeeping, then one claim:
--   1. ready papers that have chunks but no job yet get a pending job (this is the
--      automatic backfill of existing papers; nothing has to insert jobs by hand);
--   2. jobs whose paper was reprocessed are reset to pending for the new generation;
--   3. jobs abandoned by a crashed worker that already used all their attempts fail;
--   4. exactly one eligible job is claimed with FOR UPDATE SKIP LOCKED, so two
--      workers can never claim the same job.
-- p_paper_id restricts everything to a single paper (used by the manual one-paper
-- command so it cannot trigger a library-wide backfill).
-- A job is "stalled" when it is 'embedding' and its row has not been updated for
-- p_stale_after. Workers update the row after every stored batch, so a long paced job
-- is not mistaken for a crashed one.
create or replace function public.claim_next_embedding_job(
  p_paper_id uuid default null,
  p_max_attempts int default 4,
  p_stale_after interval default interval '15 minutes'
)
returns table (
  paper_id uuid,
  user_id uuid,
  model_id text,
  claim_started_at timestamptz,
  source_completed_at timestamptz,
  attempts int,
  chunk_count int,
  provider text,
  provider_model text,
  dimensions int,
  input_profile text
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_model text;
begin
  select m.id into v_model
    from public.embedding_models m
   where m.status = 'active';
  if v_model is null then
    return;
  end if;

  insert into public.paper_embedding_jobs
    (paper_id, model_id, user_id, source_completed_at)
  select p.id, v_model, p.user_id, p.processing_completed_at
    from public.papers p
   where p.status = 'ready'
     and p.processing_completed_at is not null
     and (p_paper_id is null or p.id = p_paper_id)
     and exists (select 1 from public.paper_chunks c where c.paper_id = p.id)
     and not exists (
       select 1 from public.paper_embedding_jobs j
        where j.paper_id = p.id and j.model_id = v_model
     )
  on conflict (paper_id, model_id) do nothing;

  update public.paper_embedding_jobs j
     set status = 'pending',
         attempts = 0,
         source_completed_at = p.processing_completed_at,
         claim_started_at = null,
         completed_at = null,
         chunk_count = null,
         embedded_count = 0,
         last_error = null,
         next_attempt_at = null
    from public.papers p
   where p.id = j.paper_id
     and j.model_id = v_model
     and (p_paper_id is null or j.paper_id = p_paper_id)
     and p.status = 'ready'
     and p.processing_completed_at is not null
     and j.source_completed_at is distinct from p.processing_completed_at;

  update public.paper_embedding_jobs j
     set status = 'failed',
         claim_started_at = null,
         completed_at = now(),
         last_error = 'Indexing was interrupted repeatedly and was stopped.'
   where j.model_id = v_model
     and (p_paper_id is null or j.paper_id = p_paper_id)
     and j.status = 'embedding'
     and j.updated_at < now() - p_stale_after
     and j.attempts >= p_max_attempts;

  return query
  with candidate as (
    select j.paper_id as pid
      from public.paper_embedding_jobs j
      join public.papers p on p.id = j.paper_id
     where j.model_id = v_model
       and (p_paper_id is null or j.paper_id = p_paper_id)
       and p.status = 'ready'
       and j.source_completed_at = p.processing_completed_at
       and j.attempts < p_max_attempts
       and (j.next_attempt_at is null or j.next_attempt_at <= now())
       and (
         j.status = 'pending'
         or (j.status = 'embedding' and j.updated_at < now() - p_stale_after)
       )
     order by j.created_at
     limit 1
       for update of j skip locked
  ), claimed as (
    update public.paper_embedding_jobs j
       set status = 'embedding',
           claim_started_at = clock_timestamp(),
           attempts = j.attempts + 1,
           completed_at = null,
           last_error = null,
           next_attempt_at = null,
           chunk_count = (
             select count(*)::int from public.paper_chunks c
              where c.paper_id = j.paper_id
           ),
           embedded_count = (
             select count(*)::int from public.chunk_embeddings ce
              where ce.paper_id = j.paper_id and ce.model_id = v_model
           )
      from candidate
     where j.paper_id = candidate.pid
       and j.model_id = v_model
    returning j.paper_id, j.user_id, j.model_id, j.claim_started_at,
              j.source_completed_at, j.attempts, j.chunk_count
  )
  select c.paper_id, c.user_id, c.model_id, c.claim_started_at,
         c.source_completed_at, c.attempts, c.chunk_count,
         m.provider, m.provider_model, m.dimensions, m.input_profile
    from claimed c
    join public.embedding_models m on m.id = c.model_id;
end;
$$;

-- Store a batch -----------------------------------------------------------------------
-- Fenced: does nothing (returns -1) unless the caller still holds the claim, the paper
-- is still ready in the SAME generation, and the profile is still active. Ownership is
-- taken from the job row, never from the payload; the composite foreign key on
-- chunk_embeddings then rejects any chunk that does not belong to that paper and user.
-- Rows are upserted so a chunk whose text changed is re-embedded, never silently kept.
-- The vector arrives as a JSON array of numbers and is cast to vector(1024), which
-- rejects the wrong length or non-numeric values. Returns how many chunks of this
-- paper now have an embedding for the profile.
create or replace function public.store_chunk_embeddings(
  p_paper_id uuid,
  p_model_id text,
  p_claim_started_at timestamptz,
  p_rows jsonb
)
returns int
language plpgsql
set search_path = extensions, pg_temp
as $$
declare
  v_user_id uuid;
  v_stored int;
begin
  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'p_rows must be a JSON array of 1 to 200 embeddings';
  end if;

  select j.user_id
    into v_user_id
    from public.paper_embedding_jobs j
    join public.papers p on p.id = j.paper_id
    join public.embedding_models m on m.id = j.model_id
   where j.paper_id = p_paper_id
     and j.model_id = p_model_id
     and j.status = 'embedding'
     and j.claim_started_at = p_claim_started_at
     and p.status = 'ready'
     and j.source_completed_at = p.processing_completed_at
     and m.status = 'active'
     for update of j;
  if not found then
    return -1;
  end if;

  insert into public.chunk_embeddings
    (chunk_id, model_id, paper_id, user_id, embedding, content_hash)
  select x.chunk_id, p_model_id, p_paper_id, v_user_id,
         (x.embedding::text)::vector(1024), x.content_hash
    from jsonb_to_recordset(p_rows) as x(chunk_id uuid, embedding jsonb, content_hash text)
  on conflict (chunk_id, model_id) do update
     set embedding = excluded.embedding,
         content_hash = excluded.content_hash,
         created_at = now();

  select count(*)::int
    into v_stored
    from public.chunk_embeddings ce
   where ce.paper_id = p_paper_id and ce.model_id = p_model_id;

  -- Also serves as the job's heartbeat (updated_at) for stalled-job detection.
  update public.paper_embedding_jobs j
     set embedded_count = v_stored
   where j.paper_id = p_paper_id and j.model_id = p_model_id;

  return v_stored;
end;
$$;

-- Complete ----------------------------------------------------------------------------
-- Fenced like store_chunk_embeddings. Refuses (raises) unless EVERY chunk of the paper
-- has an embedding for the profile with a recorded content hash, so a job can never be
-- "complete" with missing vectors. Returns false if the claim was lost.
create or replace function public.complete_embedding_job(
  p_paper_id uuid,
  p_model_id text,
  p_claim_started_at timestamptz
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_chunks int;
  v_embedded int;
begin
  perform 1
     from public.paper_embedding_jobs j
     join public.papers p on p.id = j.paper_id
     join public.embedding_models m on m.id = j.model_id
    where j.paper_id = p_paper_id
      and j.model_id = p_model_id
      and j.status = 'embedding'
      and j.claim_started_at = p_claim_started_at
      and p.status = 'ready'
      and j.source_completed_at = p.processing_completed_at
      and m.status = 'active'
      for update of j;
  if not found then
    return false;
  end if;

  select count(*)::int into v_chunks
    from public.paper_chunks c
   where c.paper_id = p_paper_id;

  select count(*)::int into v_embedded
    from public.paper_chunks c
    join public.chunk_embeddings ce on ce.chunk_id = c.id and ce.model_id = p_model_id
   where c.paper_id = p_paper_id
     and ce.content_hash is not null;

  if v_chunks = 0 or v_embedded <> v_chunks then
    raise exception 'cannot complete embedding job: % of % chunks are embedded',
      v_embedded, v_chunks;
  end if;

  update public.paper_embedding_jobs j
     set status = 'complete',
         claim_started_at = null,
         completed_at = now(),
         chunk_count = v_chunks,
         embedded_count = v_embedded,
         last_error = null,
         next_attempt_at = null
   where j.paper_id = p_paper_id and j.model_id = p_model_id;

  return true;
end;
$$;

-- Fail / release -----------------------------------------------------------------------
-- Ends a claim, fenced by claim_started_at (returns false if the claim was lost).
--   p_retry = true  -> back to 'pending', claimable again after p_retry_delay.
--                      p_count_attempt = false refunds the attempt (used when a worker
--                      releases a job because it is shutting down, or the provider key
--                      is unusable, which is not the job's fault).
--   p_retry = false -> 'failed' with a safe, worker-supplied message.
-- The message is written by the worker from a fixed vocabulary; nothing raw from the
-- provider or database is ever stored.
create or replace function public.fail_embedding_job(
  p_paper_id uuid,
  p_model_id text,
  p_claim_started_at timestamptz,
  p_error text,
  p_retry boolean,
  p_count_attempt boolean default true,
  p_retry_delay interval default interval '0 seconds'
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform 1
     from public.paper_embedding_jobs j
    where j.paper_id = p_paper_id
      and j.model_id = p_model_id
      and j.status = 'embedding'
      and j.claim_started_at = p_claim_started_at
      for update;
  if not found then
    return false;
  end if;

  if p_retry then
    update public.paper_embedding_jobs j
       set status = 'pending',
           claim_started_at = null,
           completed_at = null,
           last_error = null,
           next_attempt_at = now() + p_retry_delay,
           attempts = case when p_count_attempt then j.attempts
                           else greatest(j.attempts - 1, 0) end
     where j.paper_id = p_paper_id and j.model_id = p_model_id;
  else
    update public.paper_embedding_jobs j
       set status = 'failed',
           claim_started_at = null,
           completed_at = now(),
           next_attempt_at = null,
           last_error = coalesce(left(nullif(trim(p_error), ''), 1000), 'Indexing failed.')
     where j.paper_id = p_paper_id and j.model_id = p_model_id;
  end if;

  return true;
end;
$$;

-- Service role only -----------------------------------------------------------------------
revoke all on function public.claim_next_embedding_job(uuid, int, interval)
  from public, anon, authenticated;
revoke all on function public.store_chunk_embeddings(uuid, text, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_embedding_job(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.fail_embedding_job(uuid, text, timestamptz, text, boolean, boolean, interval)
  from public, anon, authenticated;

grant execute on function public.claim_next_embedding_job(uuid, int, interval) to service_role;
grant execute on function public.store_chunk_embeddings(uuid, text, timestamptz, jsonb) to service_role;
grant execute on function public.complete_embedding_job(uuid, text, timestamptz) to service_role;
grant execute on function public.fail_embedding_job(uuid, text, timestamptz, text, boolean, boolean, interval) to service_role;

commit;
