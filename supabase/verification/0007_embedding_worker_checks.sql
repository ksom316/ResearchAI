-- Manual verification for migration 0007 (embedding worker functions).
-- Run each numbered block separately in the Supabase SQL editor.
-- Blocks 1-3 are read-only. Block 4 changes data inside a transaction and ALWAYS
-- rolls back (it ends by raising an error on purpose; the message is the report).
-- Blocks 5-6 are read-only checks to run AFTER the first live index of a paper.

-- 1. The four functions exist, and ONLY the service role can execute them.
select
  p.proname,
  has_function_privilege('service_role',  p.oid, 'execute') as service_role_can_run,  -- expect true
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run, -- expect false
  has_function_privilege('anon',          p.oid, 'execute') as anon_can_run           -- expect false
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('claim_next_embedding_job', 'store_chunk_embeddings',
                    'complete_embedding_job', 'fail_embedding_job')
order by p.proname;
-- expect: 4 rows, service_role_can_run = true, the other two = false

-- 2. next_attempt_at exists, and browsers still cannot read job internals.
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'paper_embedding_jobs'
             and column_name = 'next_attempt_at')                                          as column_exists,       -- expect true
  has_column_privilege('authenticated', 'public.paper_embedding_jobs', 'next_attempt_at', 'select') as auth_read_next,   -- expect false
  has_column_privilege('authenticated', 'public.paper_embedding_jobs', 'claim_started_at', 'select') as auth_read_claim,  -- expect false
  has_column_privilege('authenticated', 'public.paper_embedding_jobs', 'last_error', 'select')       as auth_read_error,  -- expect false
  has_column_privilege('authenticated', 'public.paper_embedding_jobs', 'status', 'select')           as auth_read_status; -- expect true

-- 3. Nothing has been indexed by applying the migration, and PDF state is unchanged.
select count(*) as embeddings from public.chunk_embeddings;            -- expect 0 (before the first live index)
select count(*) as embedding_jobs from public.paper_embedding_jobs;    -- expect 0
select status, count(*) as papers from public.papers group by status order by status; -- same as before

-- 4. Behavior test on ONE existing ready paper (rolls back; the error message is the report).
--    Expect every line to end in "ok". Nothing is saved, and no Voyage call is made.
do $$
declare
  v_paper uuid;
  v_model text;
  v_job record;
  v_token timestamptz;
  v_chunk uuid;
  v_other_chunk uuid;
  v_chunks int;
  v_n int;
  v_ok boolean;
  v_good jsonb;
  v_report text := '';
begin
  select m.id into v_model from public.embedding_models m where m.status = 'active';
  select p.id into v_paper
    from public.papers p
   where p.status = 'ready'
     and exists (select 1 from public.paper_chunks c where c.paper_id = p.id)
   order by p.created_at limit 1;
  if v_paper is null or v_model is null then
    raise exception 'REPORT: needs an active profile and one ready paper with chunks';
  end if;
  select c.id into v_chunk from public.paper_chunks c where c.paper_id = v_paper order by c.chunk_index limit 1;
  select count(*)::int into v_chunks from public.paper_chunks c where c.paper_id = v_paper;
  select c.id into v_other_chunk from public.paper_chunks c where c.paper_id <> v_paper limit 1;
  v_good := jsonb_build_array(jsonb_build_object(
    'chunk_id', v_chunk,
    'embedding', (select jsonb_agg(0.01) from generate_series(1, 1024)),
    'content_hash', repeat('a', 64)));

  -- claim (scoped to this paper): the job is created lazily and claimed
  select * into v_job from public.claim_next_embedding_job(v_paper, 4, interval '15 minutes');
  if found and v_job.paper_id = v_paper and v_job.attempts = 1 then
    v_report := v_report || E'\nclaim creates + claims the job (backfill): ok';
  else
    v_report := v_report || E'\nclaim: FAILED';
  end if;
  v_token := v_job.claim_started_at;

  -- a second worker cannot claim the same job
  perform 1 from public.claim_next_embedding_job(v_paper, 4, interval '15 minutes');
  v_report := v_report || case when found then E'\nsecond claim: FAILED (job claimed twice)'
                               else E'\nsecond worker cannot claim it: ok' end;

  -- store with a wrong claim token is refused (fencing)
  v_n := public.store_chunk_embeddings(v_paper, v_model, v_token - interval '1 second', v_good);
  v_report := v_report || case when v_n = -1 then E'\nwrong claim token refused: ok'
                               else E'\nwrong claim token: FAILED' end;

  -- store a good 1024-dim vector for one chunk
  v_n := public.store_chunk_embeddings(v_paper, v_model, v_token, v_good);
  v_report := v_report || case when v_n = 1 then E'\nstore one batch: ok' else E'\nstore: FAILED' end;

  -- a vector with the wrong number of dimensions is rejected
  begin
    perform public.store_chunk_embeddings(v_paper, v_model, v_token, jsonb_build_array(jsonb_build_object(
      'chunk_id', v_chunk, 'embedding', (select jsonb_agg(0.01) from generate_series(1, 10)),
      'content_hash', repeat('a', 64))));
    v_report := v_report || E'\n10-dim vector: FAILED (accepted)';
  exception when others then
    v_report := v_report || E'\n10-dim vector rejected: ok';
  end;

  -- a chunk of a DIFFERENT paper is rejected by the composite ownership FK
  if v_other_chunk is not null then
    begin
      perform public.store_chunk_embeddings(v_paper, v_model, v_token, jsonb_build_array(jsonb_build_object(
        'chunk_id', v_other_chunk, 'embedding', (select jsonb_agg(0.01) from generate_series(1, 1024)),
        'content_hash', repeat('b', 64))));
      v_report := v_report || E'\nforeign chunk: FAILED (accepted)';
    exception when foreign_key_violation then
      v_report := v_report || E'\nforeign chunk rejected (ownership FK): ok';
    end;
  else
    v_report := v_report || E'\nforeign chunk: skipped (only one paper has chunks)';
  end if;

  -- complete is refused while chunks are missing embeddings
  if v_chunks > 1 then
    begin
      perform public.complete_embedding_job(v_paper, v_model, v_token);
      v_report := v_report || E'\ncomplete with missing chunks: FAILED (accepted)';
    exception when others then
      v_report := v_report || E'\ncomplete refused while chunks are missing: ok';
    end;
  end if;

  -- release with an attempt refund: back to pending, attempt not counted
  v_ok := public.fail_embedding_job(v_paper, v_model, v_token, '', true, false, interval '0 seconds');
  select * into v_job from public.paper_embedding_jobs j where j.paper_id = v_paper and j.model_id = v_model;
  v_report := v_report || case when v_ok and v_job.status = 'pending' and v_job.attempts = 0
                               then E'\nrelease refunds the attempt: ok' else E'\nrelease: FAILED' end;

  -- the old token can no longer act
  v_n := public.store_chunk_embeddings(v_paper, v_model, v_token, v_good);
  v_report := v_report || case when v_n = -1 then E'\nreleased claim is fenced out: ok' else E'\nfencing after release: FAILED' end;

  -- reprocessing: change the paper's generation and claim again
  select * into v_job from public.claim_next_embedding_job(v_paper, 4, interval '15 minutes');
  v_token := v_job.claim_started_at;
  update public.papers set processing_completed_at = processing_completed_at + interval '1 second' where id = v_paper;
  v_n := public.store_chunk_embeddings(v_paper, v_model, v_token, v_good);
  v_report := v_report || case when v_n = -1 then E'\nstore refused after the paper changed generation: ok'
                               else E'\nstale generation store: FAILED' end;
  select * into v_job from public.claim_next_embedding_job(v_paper, 4, interval '15 minutes');
  if found and v_job.attempts = 1
     and v_job.source_completed_at = (select p.processing_completed_at from public.papers p where p.id = v_paper) then
    v_report := v_report || E'\nreprocessed paper: job reset and re-claimed for the new generation: ok';
  else
    v_report := v_report || E'\nreprocessed paper reset: FAILED';
  end if;

  -- papers.status was never touched by any of this
  perform 1 from public.papers p where p.id = v_paper and p.status = 'ready';
  v_report := v_report || case when found then E'\nPDF status still ready: ok' else E'\nPDF status changed: FAILED' end;

  raise exception E'REPORT (everything above is rolled back):%', v_report;
end;
$$;

-- 5. AFTER the first live index of a paper (replace the id). Expect:
--    status complete, embedded_count = chunk_count, no missing hashes.
select j.status, j.attempts, j.chunk_count, j.embedded_count, j.last_error,
       j.source_completed_at = p.processing_completed_at as is_current
from public.paper_embedding_jobs j
join public.papers p on p.id = j.paper_id
where j.paper_id = 'a0a64c8f-fe48-48e9-9a5e-b106c50451b1';

select count(*) as embeddings,
       count(*) filter (where ce.content_hash is null) as missing_hashes,   -- expect 0
       min(vector_dims(ce.embedding)) as min_dims, max(vector_dims(ce.embedding)) as max_dims -- expect 1024 / 1024
from public.chunk_embeddings ce
where ce.paper_id = 'a0a64c8f-fe48-48e9-9a5e-b106c50451b1';

-- 6. Only that ONE paper was indexed, and PDF status is unchanged.
select paper_id, status, embedded_count, chunk_count from public.paper_embedding_jobs order by created_at;  -- expect 1 row
select status, count(*) as papers from public.papers group by status order by status;                        -- same as block 3
