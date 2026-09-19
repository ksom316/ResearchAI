-- Manual verification for migration 0008 (semantic search functions).
-- Run each numbered block separately in the Supabase SQL editor.
-- Blocks 1-3 are read-only. Block 4 builds throwaway fixtures inside a transaction and
-- ALWAYS rolls back (it ends by raising an error on purpose; the message is the report).
-- Nothing here calls Voyage, creates accounts, or writes auth.users; fixtures roll back.

-- 1. Grants: the two RPCs are for signed-in users only; the helper is for nobody.
select
  p.proname,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run,
  has_function_privilege('anon',          p.oid, 'execute') as anon_can_run,
  has_function_privilege('service_role',  p.oid, 'execute') as service_role_can_run,
  p.prosecdef                                               as security_definer,
  p.provolatile                                             as volatility,  -- expect 's' (stable)
  p.proconfig                                               as pinned_config
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('search_scope_paper_ids', 'get_search_coverage', 'search_paper_chunks')
order by p.proname;
-- expect get_search_coverage / search_paper_chunks: authenticated true, anon false, service_role false, definer true
-- expect search_scope_paper_ids: all three false, definer true; every row has a pinned search_path

-- 2. Vectors and jobs are still unreadable directly by browsers.
select
  has_table_privilege('authenticated', 'public.chunk_embeddings', 'select') as auth_reads_vectors,  -- expect false
  has_table_privilege('anon',          'public.chunk_embeddings', 'select') as anon_reads_vectors,  -- expect false
  has_column_privilege('authenticated', 'public.chunk_embeddings', 'embedding', 'select') as auth_reads_embedding_col, -- expect false
  has_column_privilege('authenticated', 'public.paper_embedding_jobs', 'claim_started_at', 'select') as auth_reads_claim; -- expect false

-- 3. No vector index was created, and applying 0008 changed no data.
select indexdef from pg_indexes
where tablename = 'chunk_embeddings' and indexdef ~* 'hnsw|ivfflat';   -- expect 0 rows
select count(*) as embeddings from public.chunk_embeddings;              -- unchanged by 0008
select count(*) as embedding_jobs from public.paper_embedding_jobs;      -- unchanged by 0008

-- 4. Behavior test on throwaway fixtures (rolls back; the error message is the report).
--    BEFORE RUNNING: set v_a and v_b in the declare section to two DIFFERENT existing
--    auth.users ids (no accounts are created; their auth rows are only referenced).
--    Expect every line to end in "ok". Nothing is saved.
do $$
declare
  v_model text;
  v_a uuid := '00000000-0000-0000-0000-00000000000a';  -- REPLACE: a real auth.users id (user A)
  v_b uuid := '00000000-0000-0000-0000-00000000000b';  -- REPLACE: a DIFFERENT real auth.users id (user B)
  v_t timestamptz := now() - interval '1 hour';
  v_pa uuid := gen_random_uuid();     -- A: ready + current + indexed
  v_ps uuid := gen_random_uuid();     -- A: ready, index is from an OLDER generation
  v_pu uuid := gen_random_uuid();     -- A: ready, never indexed
  v_pp uuid := gen_random_uuid();     -- A: still processing
  v_pb uuid := gen_random_uuid();     -- B: ready + indexed (must never leak to A)
  v_proj uuid := gen_random_uuid();   -- A's project (contains PA and PU)
  v_projb uuid := gen_random_uuid();  -- B's project
  v_sec uuid; v_ref uuid; v_secs uuid; v_secb uuid;
  v_c1 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid(); v_c3 uuid := gen_random_uuid();
  v_cs uuid := gen_random_uuid(); v_cb uuid := gen_random_uuid();
  v_e1 jsonb; v_e2 jsonb; v_zero jsonb; v_short jsonb; v_bad jsonb;
  v_before_emb bigint; v_before_jobs bigint;
  v_n int; v_row record; v_state text; v_msg text;
  v_report text := '';
  v_claims text;
begin
  select m.id into v_model from public.embedding_models m where m.status = 'active';
  if v_model is null then raise exception 'REPORT: needs an active embedding profile'; end if;

  -- unit vectors: e1 = [1,0,0,...], e2 = [0,1,0,...]
  select jsonb_agg(case when g = 1 then 1 else 0 end order by g) into v_e1 from generate_series(1, 1024) g;
  select jsonb_agg(case when g = 2 then 1 else 0 end order by g) into v_e2 from generate_series(1, 1024) g;
  select jsonb_agg(0 order by g) into v_zero from generate_series(1, 1024) g;
  select jsonb_agg(1 order by g) into v_short from generate_series(1, 1023) g;
  select jsonb_agg(case when g = 5 then '"x"'::jsonb else '1'::jsonb end order by g) into v_bad from generate_series(1, 1024) g;

  -- ---- fixtures (as the SQL editor's privileged role) -----------------------------------
  -- Fixture rows are owned by the two REAL users above (their auth.users rows are never
  -- written, so this does not depend on auth.users internals). Everything rolls back.
  if (select count(*) from auth.users u where u.id in (v_a, v_b)) <> 2 or v_a = v_b then
    raise exception 'REPORT: replace v_a and v_b at the top of this block with two different real auth.users ids';
  end if;

  insert into public.papers (id, user_id, title, status, processing_completed_at, page_count) values
    (v_pa, v_a, 'A current',    'ready',      v_t, 5),
    (v_ps, v_a, 'A stale',      'ready',      v_t + interval '10 minutes', 5),
    (v_pu, v_a, 'A unindexed',  'ready',      v_t, 5),
    (v_pp, v_a, 'A processing', 'processing', null, null),
    (v_pb, v_b, 'B private',    'ready',      v_t, 5);
  insert into public.research_projects (id, user_id, title) values (v_proj, v_a, 'A proj'), (v_projb, v_b, 'B proj');
  insert into public.paper_project_links (paper_id, project_id, user_id) values
    (v_pa, v_proj, v_a), (v_pu, v_proj, v_a), (v_pb, v_projb, v_b);

  insert into public.paper_sections (paper_id, user_id, position, title, section_type, text)
    values (v_pa, v_a, 0, 'Method', 'methods', 'body') returning id into v_sec;
  insert into public.paper_sections (paper_id, user_id, position, title, section_type, text)
    values (v_pa, v_a, 1, 'References', 'references', 'refs') returning id into v_ref;
  insert into public.paper_sections (paper_id, user_id, position, title, section_type, text)
    values (v_ps, v_a, 0, 'Method', 'methods', 'body') returning id into v_secs;
  insert into public.paper_sections (paper_id, user_id, position, title, section_type, text)
    values (v_pb, v_b, 0, 'Method', 'methods', 'body') returning id into v_secb;

  insert into public.paper_chunks (id, paper_id, user_id, section_id, chunk_index, text, char_start, char_end) values
    (v_c1, v_pa, v_a, v_sec, 0, 'exact match chunk', 0, 10),
    (v_c2, v_pa, v_a, v_sec, 1, 'orthogonal chunk',  10, 20),
    (v_c3, v_pa, v_a, v_ref, 2, 'reference chunk',   0, 10),   -- same vector as the query
    (v_cs, v_ps, v_a, v_secs, 0, 'stale chunk',      0, 10),
    (v_cb, v_pb, v_b, v_secb, 0, 'other tenant chunk', 0, 10);

  insert into public.chunk_embeddings (chunk_id, model_id, paper_id, user_id, embedding, content_hash) values
    (v_c1, v_model, v_pa, v_a, (v_e1::text)::extensions.vector(1024), repeat('a', 64)),
    (v_c2, v_model, v_pa, v_a, (v_e2::text)::extensions.vector(1024), repeat('b', 64)),
    (v_c3, v_model, v_pa, v_a, (v_e1::text)::extensions.vector(1024), repeat('c', 64)),
    (v_cs, v_model, v_ps, v_a, (v_e1::text)::extensions.vector(1024), repeat('d', 64)),
    (v_cb, v_model, v_pb, v_b, (v_e1::text)::extensions.vector(1024), repeat('e', 64));

  insert into public.paper_embedding_jobs
    (paper_id, model_id, user_id, status, attempts, source_completed_at, completed_at, chunk_count, embedded_count) values
    (v_pa, v_model, v_a, 'complete', 1, v_t, now(), 3, 3),
    (v_ps, v_model, v_a, 'complete', 1, v_t, now(), 1, 1),     -- OLDER generation than the paper
    (v_pb, v_model, v_b, 'complete', 1, v_t, now(), 1, 1);

  select count(*) into v_before_emb from public.chunk_embeddings;
  select count(*) into v_before_jobs from public.paper_embedding_jobs;

  -- ---- become user A (a signed-in browser) -------------------------------------------------
  v_claims := json_build_object('sub', v_a, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  -- direct access to vectors and the private helper is denied
  begin
    perform 1 from public.chunk_embeddings limit 1;
    v_report := v_report || E'\ndirect vector read: FAILED (allowed)';
  exception when insufficient_privilege then
    v_report := v_report || E'\ndirect vector read denied: ok';
  end;
  begin
    perform * from public.search_scope_paper_ids(null, null);
    v_report := v_report || E'\nprivate helper callable: FAILED';
  exception when insufficient_privilege then
    v_report := v_report || E'\nprivate helper not callable by browsers: ok';
  end;

  -- happy path: exact match first, reference chunk excluded, other tenant + stale invisible
  select count(*), min(x.chunk_id::text) filter (where x.rank = 1)
    into v_n, v_msg
    from public.search_paper_chunks(v_e1, v_model, array[v_pa]) x;
  v_report := v_report || case when v_n = 2 and v_msg = v_c1::text
    then E'\nfixture paper search: reference chunk excluded, exact match ranked first: ok'
    else E'\nfixture paper search: FAILED (rows=' || v_n || ')' end;

  select x.similarity into v_row from public.search_paper_chunks(v_e1, v_model, array[v_pa]) x where x.chunk_id = v_c1;
  v_report := v_report || case when abs(v_row.similarity - 1) < 1e-9 then E'\nsimilarity of identical vector is 1: ok'
    else E'\nsimilarity: FAILED' end;
  select x.similarity into v_row from public.search_paper_chunks(v_e1, v_model, array[v_pa]) x where x.chunk_id = v_c2;
  v_report := v_report || case when abs(v_row.similarity) < 1e-9 then E'\nsimilarity of orthogonal vector is 0: ok'
    else E'\northogonal similarity: FAILED' end;

  perform 1 from public.search_paper_chunks(v_e1, v_model) x where x.paper_id in (v_pb, v_ps);
  v_report := v_report || case when found then E'\ncross-tenant / stale leak: FAILED' else E'\nother tenant and stale generation never returned: ok' end;

  -- references: excluded by default, includable
  select count(*) into v_n from public.search_paper_chunks(v_e1, v_model, array[v_pa], null, 10, null, true);
  perform 1 from public.search_paper_chunks(v_e1, v_model, array[v_pa]) x where x.chunk_id = v_c3;
  if found then v_report := v_report || E'\nreference chunk returned by default: FAILED'; end if;
  v_report := v_report || case when v_n = 3 then E'\ninclude_references brings the reference chunk back: ok' else E'\nreferences flag: FAILED' end;

  -- limit, clamp and min similarity
  select count(*) into v_n from public.search_paper_chunks(v_e1, v_model, array[v_pa], null, 1);
  v_report := v_report || case when v_n = 1 then E'\nlimit 1: ok' else E'\nlimit: FAILED' end;
  select count(*) into v_n from public.search_paper_chunks(v_e1, v_model, array[v_pa], null, 0);
  v_report := v_report || case when v_n = 1 then E'\nlimit 0 clamps to 1: ok' else E'\nlimit clamp: FAILED' end;
  select count(*) into v_n from public.search_paper_chunks(v_e1, v_model, array[v_pa], null, 10, 0.5);
  v_report := v_report || case when v_n = 1 then E'\nmin_similarity filters the orthogonal chunk: ok' else E'\nmin_similarity: FAILED' end;
  begin
    perform 1 from public.search_paper_chunks(v_e1, v_model, null, null, 10, 1.5);
    v_report := v_report || E'\nmin_similarity 1.5: FAILED (accepted)';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_report := v_report || case when v_msg = 'search_invalid_argument' then E'\nmin_similarity out of range rejected: ok' else E'\nmin_similarity error: ' || v_msg end;
  end;

  -- scopes
  select count(*) into v_n from public.search_paper_chunks(v_e1, v_model, array[v_pa]);
  v_report := v_report || case when v_n = 2 then E'\nsingle-paper scope: ok' else E'\nsingle paper: FAILED' end;
  select count(*) into v_n from public.search_paper_chunks(v_e1, v_model, array[v_pa, v_pa, v_pu]);
  v_report := v_report || case when v_n = 2 then E'\nduplicate ids tolerated, unindexed paper contributes nothing: ok' else E'\nselected papers: FAILED' end;
  select count(*) into v_n from public.search_paper_chunks(v_e1, v_model, null, v_proj);
  v_report := v_report || case when v_n = 2 then E'\nproject scope: ok' else E'\nproject scope: FAILED' end;
  select count(*) into v_n from public.search_paper_chunks(v_e1, v_model, array[v_pu]);
  v_report := v_report || case when v_n = 0 then E'\nunindexed paper returns empty, not an error: ok' else E'\nunindexed: FAILED' end;

  -- uniform scope errors: foreign paper, foreign project, random ids look identical
  foreach v_state in array array['foreign paper', 'foreign project', 'unknown paper', 'unknown project', 'mixed list'] loop
    begin
      if v_state = 'foreign paper' then perform 1 from public.search_paper_chunks(v_e1, v_model, array[v_pb]);
      elsif v_state = 'foreign project' then perform 1 from public.search_paper_chunks(v_e1, v_model, null, v_projb);
      elsif v_state = 'unknown paper' then perform 1 from public.search_paper_chunks(v_e1, v_model, array[gen_random_uuid()]);
      elsif v_state = 'unknown project' then perform 1 from public.search_paper_chunks(v_e1, v_model, null, gen_random_uuid());
      else perform 1 from public.search_paper_chunks(v_e1, v_model, array[v_pa, v_pb]);
      end if;
      v_report := v_report || E'\n' || v_state || ': FAILED (accepted)';
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_report := v_report || case when v_msg = 'search_scope_not_found'
        then E'\n' || v_state || ' -> search_scope_not_found: ok' else E'\n' || v_state || ': FAILED (' || v_msg || ')' end;
    end;
  end loop;
  begin
    perform 1 from public.get_search_coverage(array[v_pb]);
    v_report := v_report || E'\ncoverage foreign paper: FAILED';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_report := v_report || case when v_msg = 'search_scope_not_found' then E'\ncoverage foreign paper -> uniform error: ok' else E'\ncoverage foreign: FAILED' end;
  end;

  -- vector validation and model checks
  foreach v_state in array array['zero', 'short', 'non-numeric', 'not-an-array', 'null'] loop
    begin
      perform 1 from public.search_paper_chunks(
        case v_state when 'zero' then v_zero when 'short' then v_short when 'non-numeric' then v_bad
                     when 'not-an-array' then '{"a":1}'::jsonb else null end, v_model);
      v_report := v_report || E'\n' || v_state || ' query vector: FAILED (accepted)';
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_report := v_report || case when v_msg = 'search_invalid_embedding'
        then E'\n' || v_state || ' query vector rejected: ok' else E'\n' || v_state || ': FAILED (' || v_msg || ')' end;
    end;
  end loop;
  begin
    perform 1 from public.search_paper_chunks(v_e1, 'some-other-model:1024:x');
    v_report := v_report || E'\nwrong expected model: FAILED (accepted)';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_report := v_report || case when v_msg = 'search_model_mismatch' then E'\nmodel mismatch rejected: ok' else E'\nmodel mismatch: FAILED (' || v_msg || ')' end;
  end;

  -- coverage states
  select c.state into v_state from public.get_search_coverage() c where c.paper_id = v_pa;
  v_report := v_report || case when v_state = 'searchable' then E'\ncoverage current paper = searchable: ok' else E'\ncoverage searchable: FAILED (' || coalesce(v_state, 'null') || ')' end;
  select c.state into v_state from public.get_search_coverage() c where c.paper_id = v_ps;
  v_report := v_report || case when v_state = 'index_stale' then E'\ncoverage older generation = index_stale: ok' else E'\ncoverage stale: FAILED (' || coalesce(v_state, 'null') || ')' end;
  select c.state into v_state from public.get_search_coverage() c where c.paper_id = v_pu;
  v_report := v_report || case when v_state = 'not_indexed' then E'\ncoverage no job = not_indexed: ok' else E'\ncoverage not_indexed: FAILED' end;
  select c.state into v_state from public.get_search_coverage() c where c.paper_id = v_pp;
  v_report := v_report || case when v_state = 'pdf_processing' then E'\ncoverage processing PDF = pdf_processing: ok' else E'\ncoverage pdf_processing: FAILED' end;
  select count(*) into v_n from public.get_search_coverage() c where c.paper_id = v_pb;
  v_report := v_report || case when v_n = 0 then E'\ncoverage never lists other tenants: ok' else E'\ncoverage leak: FAILED' end;
  select count(*) into v_n from public.get_search_coverage(null, v_proj);
  v_report := v_report || case when v_n = 2 then E'\ncoverage project scope: ok' else E'\ncoverage project: FAILED' end;

  -- generation change: reprocessing the current paper makes it stale immediately
  reset role;
  update public.papers set processing_completed_at = v_t + interval '5 minutes' where id = v_pa;
  set local role authenticated;
  select count(*) into v_n from public.search_paper_chunks(v_e1, v_model, array[v_pa]);
  v_report := v_report || case when v_n = 0 then E'\nreprocessed paper: old vectors no longer returned: ok' else E'\nstale generation still searchable: FAILED' end;

  -- inactive model: retire the profile, nothing may be searchable
  reset role;
  update public.papers set processing_completed_at = v_t where id = v_pa;
  update public.embedding_models set status = 'retired' where id = v_model;
  set local role authenticated;
  begin
    perform 1 from public.search_paper_chunks(v_e1, v_model);
    v_report := v_report || E'\nsearch with no active model: FAILED (accepted)';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_report := v_report || case when v_msg = 'search_model_mismatch' then E'\nno active model -> search_model_mismatch: ok' else E'\nno active model: FAILED (' || v_msg || ')' end;
  end;
  reset role;
  update public.embedding_models set status = 'active' where id = v_model;

  -- unauthenticated: no subject in the token
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  begin
    perform 1 from public.search_paper_chunks(v_e1, v_model);
    v_report := v_report || E'\nno auth.uid(): FAILED (accepted)';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_report := v_report || case when v_msg = 'search_unauthenticated' then E'\nno auth.uid() -> search_unauthenticated: ok' else E'\nunauthenticated: FAILED (' || v_msg || ')' end;
  end;
  reset role;

  -- non-mutation
  select count(*) into v_n from public.chunk_embeddings;
  v_report := v_report || case when v_n = v_before_emb then E'\nchunk_embeddings unchanged by searching: ok' else E'\nembeddings changed: FAILED' end;
  select count(*) into v_n from public.paper_embedding_jobs;
  v_report := v_report || case when v_n = v_before_jobs then E'\nembedding jobs unchanged by searching: ok' else E'\njobs changed: FAILED' end;

  raise exception E'REPORT (everything above is rolled back):%', v_report;
end;
$$;
