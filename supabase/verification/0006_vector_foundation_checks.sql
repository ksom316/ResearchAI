-- Manual verification for migration 0006 (pgvector foundation).
-- Run each numbered block separately in the Supabase SQL editor. Blocks 1-6 are
-- read-only. Block 7 changes data inside a transaction and ALWAYS rolls back (it
-- ends by raising an error on purpose; the message is the test report).

-- 0. BEFORE applying 0006 (optional): baseline of your existing data, to compare
--    with block 6 afterwards. Nothing here should change.
select status, count(*) as papers from public.papers group by status order by status;
select count(*) as chunks from public.paper_chunks;

-- 1. pgvector installed, and its version (needs >= 0.5.0; Supabase ships >= 0.7).
select name, default_version, installed_version, schema
from pg_available_extensions e
left join pg_extension x on x.extname = e.name
left join lateral (select nspname as schema from pg_namespace where oid = x.extnamespace) s on true
where e.name = 'vector';
-- expect: installed_version populated, schema = extensions

-- 2. The three tables exist with RLS enabled.
select relname, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('embedding_models', 'chunk_embeddings', 'paper_embedding_jobs')
order by relname;
-- expect: 3 rows, rls_enabled = true for all

-- 3. The embedding column is vector(1024), and there is NO vector index.
select format_type(a.atttypid, a.atttypmod) as embedding_type
from pg_attribute a
where a.attrelid = 'public.chunk_embeddings'::regclass and a.attname = 'embedding';
-- expect: vector(1024)

select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'chunk_embeddings' order by indexname;
-- expect: 4 rows (pkey + 3 btree). None may mention hnsw, ivfflat or vector_*_ops.

-- 4. Model registry: the Voyage profile is seeded and is the only active one.
select id, provider, provider_model, dimensions, input_profile, status, min_similarity
from public.embedding_models order by id;
-- expect: voyage-4:1024:ctx-v1 | voyage | voyage-4 | 1024 | ctx-v1 | active | (null)

-- 5. Privileges. Every "authenticated"/"anon" answer below must match "expect".
select
  has_table_privilege('authenticated', 'public.chunk_embeddings', 'select')           as auth_read_vectors,   -- expect false
  has_table_privilege('authenticated', 'public.chunk_embeddings', 'insert')           as auth_write_vectors,  -- expect false
  has_table_privilege('anon',          'public.chunk_embeddings', 'select')           as anon_read_vectors,   -- expect false
  has_column_privilege('authenticated', 'public.chunk_embeddings', 'embedding', 'select') as auth_read_embedding_col, -- expect false
  has_table_privilege('authenticated', 'public.paper_embedding_jobs', 'insert')       as auth_write_jobs,     -- expect false
  has_table_privilege('authenticated', 'public.paper_embedding_jobs', 'update')       as auth_update_jobs,    -- expect false
  has_column_privilege('authenticated', 'public.paper_embedding_jobs', 'status', 'select')           as auth_read_status,    -- expect true
  has_column_privilege('authenticated', 'public.paper_embedding_jobs', 'last_error', 'select')       as auth_read_error,     -- expect false
  has_column_privilege('authenticated', 'public.paper_embedding_jobs', 'claim_started_at', 'select') as auth_read_claim,     -- expect false
  has_column_privilege('authenticated', 'public.paper_embedding_jobs', 'attempts', 'select')         as auth_read_attempts,  -- expect false
  has_table_privilege('service_role', 'public.chunk_embeddings', 'insert')            as service_write_vectors; -- expect true

select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename in ('embedding_models', 'chunk_embeddings', 'paper_embedding_jobs')
order by tablename, policyname;
-- expect: NO policy on chunk_embeddings; one SELECT policy each on the other two

-- 6. Existing data untouched, and nothing is "searchable" yet.
select status, count(*) as papers from public.papers group by status order by status;
select count(*) as chunks from public.paper_chunks;                  -- same numbers as block 0
select count(*) as embeddings from public.chunk_embeddings;          -- expect 0
select count(*) as embedding_jobs from public.paper_embedding_jobs;  -- expect 0

-- 7. Behavior test (rolls back; the final error message is the report).
--    Needs at least one existing chunk (a processed paper). Expect every line "ok".
do $$
declare
  v_chunk public.paper_chunks%rowtype;
  v_vec vector(1024) := ('[' || array_to_string(array_fill(0.01::real, array[1024]), ',') || ']')::vector(1024);
  v_report text := '';
begin
  select * into v_chunk from public.paper_chunks limit 1;
  if not found then
    raise exception 'REPORT: no chunks yet; process a paper with the worker first, then re-run block 7';
  end if;

  -- correct owner: allowed
  insert into public.chunk_embeddings (chunk_id, model_id, paper_id, user_id, embedding)
  values (v_chunk.id, 'voyage-4:1024:ctx-v1', v_chunk.paper_id, v_chunk.user_id, v_vec);
  v_report := v_report || E'\ninsert with correct owner: ok';

  -- wrong owner: must be rejected by the composite foreign key
  begin
    insert into public.chunk_embeddings (chunk_id, model_id, paper_id, user_id, embedding)
    values (v_chunk.id, 'voyage-4:1024:ctx-v1', v_chunk.paper_id, gen_random_uuid(), v_vec);
    v_report := v_report || E'\nwrong-owner insert: FAILED (was accepted)';
  exception when foreign_key_violation or unique_violation then
    v_report := v_report || E'\nwrong-owner insert rejected: ok';
  end;

  -- second embedding for the same chunk + model: must be rejected
  begin
    insert into public.chunk_embeddings (chunk_id, model_id, paper_id, user_id, embedding)
    values (v_chunk.id, 'voyage-4:1024:ctx-v1', v_chunk.paper_id, v_chunk.user_id, v_vec);
    v_report := v_report || E'\nduplicate embedding: FAILED (was accepted)';
  exception when unique_violation then
    v_report := v_report || E'\nduplicate embedding rejected: ok';
  end;

  -- a second active profile: must be rejected
  begin
    insert into public.embedding_models (id, provider, provider_model, dimensions, input_profile, status)
    values ('test:1024:v1', 'test', 'test-model', 1024, 'v1', 'active');
    v_report := v_report || E'\nsecond active model: FAILED (was accepted)';
  exception when unique_violation then
    v_report := v_report || E'\nsecond active model rejected: ok';
  end;

  -- a non-1024 profile: must be rejected
  begin
    insert into public.embedding_models (id, provider, provider_model, dimensions, input_profile, status)
    values ('test:768:v1', 'test', 'test-model', 768, 'v1', 'building');
    v_report := v_report || E'\n768-dim profile: FAILED (was accepted)';
  exception when check_violation then
    v_report := v_report || E'\n768-dim profile rejected: ok';
  end;

  -- identity columns are immutable
  begin
    update public.embedding_models set provider_model = 'other' where id = 'voyage-4:1024:ctx-v1';
    v_report := v_report || E'\nidentity change: FAILED (was accepted)';
  exception when others then
    v_report := v_report || E'\nidentity change rejected: ok';
  end;

  -- deleting the chunk (what reprocessing does) removes its vector
  delete from public.paper_chunks where id = v_chunk.id;
  if exists (select 1 from public.chunk_embeddings where chunk_id = v_chunk.id) then
    v_report := v_report || E'\ncascade on chunk delete: FAILED';
  else
    v_report := v_report || E'\ncascade on chunk delete: ok';
  end if;

  -- job state consistency: 'complete' needs every chunk embedded
  begin
    insert into public.paper_embedding_jobs
      (paper_id, model_id, user_id, status, source_completed_at, completed_at, chunk_count, embedded_count)
    select p.id, 'voyage-4:1024:ctx-v1', p.user_id, 'complete', now(), now(), 10, 3
    from public.papers p limit 1;
    v_report := v_report || E'\nincomplete job marked complete: FAILED (was accepted)';
  exception when check_violation then
    v_report := v_report || E'\nincomplete job marked complete rejected: ok';
  end;

  raise exception E'REPORT (everything above is rolled back):%', v_report;
end;
$$;
-- expect: an error whose message lists every line ending in "ok". Nothing is saved.
