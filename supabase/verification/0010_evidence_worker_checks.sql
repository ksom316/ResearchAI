-- Manual verification for migrations 0010 + 0011 (Evidence Matrix request queue + worker).
-- Run AFTER applying BOTH 0010 and 0011, each numbered block separately in the Supabase
-- SQL editor. Blocks 1-3 are read-only. Block 4 builds throwaway fixtures in ONE
-- transaction and ALWAYS rolls back (it ends by raising an error on purpose; the message
-- is the report). Nothing here calls an LLM, creates accounts, or writes auth.users.
--
-- NOTE: claim_next_paper_extraction(p_schema_version, p_max_attempts, p_stale_after) --
-- the FIRST argument is the schema version. Block 4 always passes both explicitly.
-- NOTE: inside one transaction now() is constant (the transaction start), which is why
-- 0011 tags fields with the exact claim token instead of comparing timestamps.

-- 1. Privileges: browsers may run ONLY request_paper_extraction.
select p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run,
       has_function_privilege('anon',          p.oid, 'execute') as anon_can_run,
       has_function_privilege('service_role',  p.oid, 'execute') as service_role_can_run
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('request_paper_extraction', 'claim_next_paper_extraction',
                    'retry_paper_extraction', 'complete_paper_extraction',
                    'claim_paper_extraction', 'store_extraction_field', 'fail_paper_extraction')
order by p.proname;
-- expect:
--   request_paper_extraction   true  / false / false
--   every other row            false / false / true

-- 2. request_paper_extraction is SECURITY DEFINER with a pinned search_path.
select proname, prosecdef as security_definer, proconfig
from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'request_paper_extraction';
-- expect: security_definer = true, proconfig contains search_path=""

-- 3. 0011: the run marker exists and is hidden from browsers.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'paper_extraction_fields' and column_name = 'claim_started_at';
-- expect: 1 row (timestamp with time zone)
select has_column_privilege('authenticated', 'public.paper_extraction_fields', 'claim_started_at', 'select') as auth_reads_marker,  -- expect false
       has_column_privilege('anon',          'public.paper_extraction_fields', 'claim_started_at', 'select') as anon_reads_marker,  -- expect false
       has_column_privilege('authenticated', 'public.paper_extraction_fields', 'value', 'select')            as auth_reads_value;   -- expect true

-- 4. Behavior on throwaway fixtures (rolls back; the error message is the report).
--    BEFORE RUNNING: set v_a and v_b to two DIFFERENT existing auth.users ids.
--    Expect every line to end in "ok". Nothing is saved.
--
--    State machine (gN = processing generation, tN = claim token; every claim below is a
--    genuine claim_next_paper_extraction call, never a hand-edited status):
--      P1  g1: request -> claim t1 -> 7 not_reported -> complete(NULL,NULL) -> complete
--      P2  g1: request on current complete = no-op
--      P3  g2: request (stale) -> pending, fields kept -> claim t2 resets, attempts 1
--          retry(t2) -> pending -> request no-op (attempts 1) -> claim t3 (attempts 2)
--          -> request while running no-op -> fail(t3) -> request = fresh budget
--      P4  claim t4: NULL / blank / failed / extracted invariants, stale-field partial
--      P5  request (partial) -> claim t5 -> 7 fields -> complete('openrouter', model)
--      P6  g3 request -> claim t6; g4 arrives mid-run -> writes refused, nothing deleted
--          early; next claim t7 resets, old token fenced
--      P7  abandoned t7 -> reclaimed as t8 (attempts 2) -> abandoned again -> failed at max 2
do $$
declare
  v_a uuid := '00000000-0000-0000-0000-00000000000a';  -- REPLACE: real auth.users id (user A)
  v_b uuid := '00000000-0000-0000-0000-00000000000b';  -- REPLACE: a DIFFERENT real auth.users id (user B)
  v_t timestamptz := now() - interval '1 hour';        -- g1
  v_pa uuid := gen_random_uuid();    -- A's ready paper
  v_pb uuid := gen_random_uuid();    -- B's ready paper
  v_pn uuid := gen_random_uuid();    -- A's paper that is not ready
  v_pu uuid := gen_random_uuid();    -- A's ready paper that is NEVER requested
  v_sa uuid;
  v_ca uuid := gen_random_uuid();
  v_r text; v_txt text; v_n int; v_ok boolean;
  v_t1 timestamptz; v_t2 timestamptz; v_t3 timestamptz; v_t4 timestamptz;
  v_t5 timestamptz; v_t6 timestamptz; v_t7 timestamptz; v_t8 timestamptz;
  v_paper uuid;
  v_key text;
  v_report text := '';
  v_claims text;
  v_src jsonb;
begin
  if (select count(*) from auth.users u where u.id in (v_a, v_b)) <> 2 or v_a = v_b then
    raise exception 'REPORT: replace v_a and v_b at the top of this block with two different real auth.users ids';
  end if;
  if exists (select 1 from public.paper_extractions) then
    v_report := v_report || E'\nNOTE: paper_extractions already has rows; claim_next may pick another user''s pending row';
  end if;

  insert into public.papers (id, user_id, title, status, processing_completed_at, page_count) values
    (v_pa, v_a, 'Paper A', 'ready', v_t, 5),
    (v_pb, v_b, 'Paper B', 'ready', v_t, 5),
    (v_pu, v_a, 'Paper U', 'ready', v_t, 5);
  insert into public.papers (id, user_id, title, status) values (v_pn, v_a, 'Not ready', 'uploaded');
  insert into public.paper_sections (paper_id, user_id, position, title, section_type, text, page_start, page_end)
    values (v_pa, v_a, 0, 'Abstract', 'abstract', 'body', 1, 1) returning id into v_sa;
  insert into public.paper_chunks (id, paper_id, user_id, section_id, chunk_index, text, char_start, char_end, page_start, page_end)
    values (v_ca, v_pa, v_a, v_sa, 0, 'We study widgets.', 0, 17, 1, 1);
  v_src := jsonb_build_array(jsonb_build_object('item_index', 0, 'chunk_id', v_ca, 'excerpt', 'We study widgets.'));

  v_claims := json_build_object('sub', v_a, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- ======== P1: request, queue boundary, first claim ==========================================
  set local role authenticated;
  select public.request_paper_extraction(v_pa) into v_r;
  v_report := v_report || case when v_r = 'requested' then E'\nfirst request queues the extraction: ok' else E'\nrequest: FAILED (' || v_r || ')' end;
  select public.request_paper_extraction(v_pa) into v_r;
  v_report := v_report || case when v_r = 'unchanged' then E'\nrepeated request is a no-op (idempotent): ok' else E'\nidempotence: FAILED (' || v_r || ')' end;
  select public.request_paper_extraction(v_pb) into v_r;
  v_report := v_report || case when v_r = 'not_found' then E'\nsomeone else''s paper looks like a missing paper: ok' else E'\nownership: FAILED (' || v_r || ')' end;
  select public.request_paper_extraction(gen_random_uuid()) into v_r;
  v_report := v_report || case when v_r = 'not_found' then E'\nunknown paper: not_found: ok' else E'\nunknown paper: FAILED' end;
  select public.request_paper_extraction(v_pn) into v_r;
  v_report := v_report || case when v_r = 'not_ready' then E'\nowned paper that is not ready is refused: ok' else E'\nnot ready: FAILED (' || v_r || ')' end;
  begin
    perform public.claim_next_paper_extraction(1, 3);
    v_report := v_report || E'\nbrowser can run claim_next: FAILED';
  exception when insufficient_privilege then
    v_report := v_report || E'\nbrowser cannot run the worker functions: ok';
  end;
  reset role;

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.request_paper_extraction(v_pa);
    v_report := v_report || E'\nrequest without auth.uid(): FAILED';
  exception when others then
    v_report := v_report || E'\nrequest without auth.uid() is refused: ok';
  end;
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  select e.user_id = v_a and e.schema_version = 1 and e.status = 'pending' and e.attempts = 0
    into v_ok from public.paper_extractions e where e.paper_id = v_pa;
  v_report := v_report || case when v_ok then E'\nrow has the caller as owner, version 1, pending, 0 attempts: ok' else E'\nrequest row: FAILED' end;

  set local role service_role;
  select c.paper_id, c.claim_started_at, c.attempts into v_paper, v_t1, v_n from public.claim_next_paper_extraction(1, 3) c;
  reset role;
  v_report := v_report || case when v_paper = v_pa and v_t1 is not null and v_n = 1
    then E'\nworker claims the requested extraction (attempt 1): ok' else E'\nclaim_next: FAILED' end;
  select count(*) into v_n from public.paper_extractions where paper_id in (v_pu, v_pb, v_pn);
  v_report := v_report || case when v_n = 0 then E'\nunrequested ready papers get no row and are never processed: ok' else E'\nunrequested: FAILED' end;
  set local role service_role;
  select c.paper_id into v_paper from public.claim_next_paper_extraction(1, 3) c;
  reset role;
  v_report := v_report || case when v_paper is null then E'\nnothing else is claimable (a running extraction is not reclaimable): ok' else E'\nsecond claim: FAILED' end;

  -- NULL/NULL completion: seven fields written by THIS claim, all not_reported
  set local role service_role;
  foreach v_key in array array['objective', 'methodology', 'dataset', 'findings', 'limitations', 'future_work', 'concepts'] loop
    perform public.store_extraction_field(v_pa, 1, v_t1, v_key, 'not_reported', '{"items":[]}');
  end loop;
  select public.complete_paper_extraction(v_pa, 1, v_t1, null, null) into v_txt;
  reset role;
  select e.provider is null and e.model is null into v_ok from public.paper_extractions e where e.paper_id = v_pa;
  v_report := v_report || case when v_txt = 'complete' and v_ok
    then E'\nno-evidence extraction completes with NULL provider/model: ok' else E'\nnull completion: FAILED (' || coalesce(v_txt, 'null') || ')' end;
  select count(*) into v_n from public.paper_extraction_fields where paper_id = v_pa and claim_started_at = v_t1;
  v_report := v_report || case when v_n = 7 then E'\nevery field carries the claim token of the run that wrote it: ok' else E'\nrun marker: FAILED (' || v_n || ')' end;

  -- ======== P2: current complete is a no-op ===================================================
  set local role authenticated;
  select public.request_paper_extraction(v_pa) into v_r;
  reset role;
  v_report := v_report || case when v_r = 'unchanged' then E'\nrequest on a current complete extraction is a no-op: ok' else E'\ncomplete no-op: FAILED (' || v_r || ')' end;

  -- ======== P3: reprocessing (g2), retry budget ================================================
  update public.papers set processing_completed_at = v_t + interval '5 minutes' where id = v_pa;
  set local role authenticated;
  select public.request_paper_extraction(v_pa) into v_r;
  reset role;
  select count(*) into v_n from public.paper_extraction_fields where paper_id = v_pa;
  select e.status = 'pending' and e.attempts = 0 and e.source_completed_at = v_t into v_ok from public.paper_extractions e where e.paper_id = v_pa;
  v_report := v_report || case when v_r = 'requested' and v_n = 7 and v_ok
    then E'\nstale extraction: request re-queues, old fields kept, generation not re-stamped: ok'
    else E'\nstale request: FAILED (' || v_r || '/' || v_n || ')' end;

  set local role service_role;
  select c.claim_started_at, c.attempts into v_t2, v_n from public.claim_next_paper_extraction(1, 3) c;
  reset role;
  select count(*) into v_n from public.paper_extraction_fields where paper_id = v_pa;
  select e.source_completed_at = v_t + interval '5 minutes' and e.attempts = 1 into v_ok from public.paper_extractions e where e.paper_id = v_pa;
  v_report := v_report || case when v_t2 is not null and v_t2 <> v_t1 and v_n = 0 and v_ok
    then E'\nworker claim performs the generation reset (old fields gone, new generation, attempt 1): ok' else E'\ngeneration reset: FAILED' end;

  set local role service_role;
  select public.retry_paper_extraction(v_pa, 1, v_t2 - interval '1 second') into v_ok;
  v_report := v_report || case when v_ok is false then E'\nretry with a wrong token is fenced out: ok' else E'\nretry fencing: FAILED' end;
  select public.retry_paper_extraction(v_pa, 1, v_t2) into v_ok;
  reset role;
  select e.status = 'pending' and e.attempts = 1 into v_txt from public.paper_extractions e where e.paper_id = v_pa;
  v_report := v_report || case when v_ok and v_txt = 'true' then E'\nretry with the valid token re-queues and keeps attempts: ok' else E'\nretry: FAILED' end;

  set local role authenticated;
  select public.request_paper_extraction(v_pa) into v_r;
  reset role;
  select e.attempts into v_n from public.paper_extractions e where e.paper_id = v_pa;
  v_report := v_report || case when v_r = 'unchanged' and v_n = 1
    then E'\nre-requesting a pending extraction is a no-op and keeps its attempts: ok' else E'\nbudget refresh: FAILED (' || v_r || '/' || v_n || ')' end;

  set local role service_role;
  select c.claim_started_at, c.attempts into v_t3, v_n from public.claim_next_paper_extraction(1, 3) c;
  reset role;
  v_report := v_report || case when v_t3 is not null and v_n = 2 then E'\nthe next claim is attempt 2: ok' else E'\nattempt 2: FAILED' end;

  set local role authenticated;
  select public.request_paper_extraction(v_pa) into v_r;
  reset role;
  select e.attempts into v_n from public.paper_extractions e where e.paper_id = v_pa;
  v_report := v_report || case when v_r = 'unchanged' and v_n = 2
    then E'\nre-requesting a running extraction is a no-op: ok' else E'\nrunning request: FAILED (' || v_r || '/' || v_n || ')' end;

  set local role service_role;
  select public.fail_paper_extraction(v_pa, 1, v_t3, 'boom') into v_ok;
  reset role;
  set local role authenticated;
  select public.request_paper_extraction(v_pa) into v_r;
  reset role;
  select e.status = 'pending' and e.attempts = 0 and e.last_error is null into v_ok from public.paper_extractions e where e.paper_id = v_pa;
  v_report := v_report || case when v_r = 'requested' and v_ok then E'\nfailed extraction: a deliberate request re-queues with a fresh budget: ok' else E'\nfailed request: FAILED (' || v_r || ')' end;

  -- ======== P4: NULL / blank / failed / extracted invariants (genuine claim t4) ===============
  set local role service_role;
  select c.claim_started_at, c.attempts into v_t4, v_n from public.claim_next_paper_extraction(1, 3) c;
  reset role;
  v_report := v_report || case when v_t4 is not null and v_n = 1 then E'\nfresh claim after the request starts at attempt 1: ok' else E'\nclaim t4: FAILED' end;

  set local role service_role;
  perform public.store_extraction_field(v_pa, 1, v_t4, 'objective', 'not_reported', '{"items":[]}');
  begin
    perform public.complete_paper_extraction(v_pa, 1, v_t4, null, null);
    v_report := v_report || E'\nNULL/NULL with missing fields: FAILED (accepted)';
  exception when raise_exception then
    v_report := v_report || E'\nNULL/NULL with missing fields refused: ok';
  end;
  foreach v_key in array array['methodology', 'dataset', 'findings', 'limitations', 'future_work', 'concepts'] loop
    perform public.store_extraction_field(v_pa, 1, v_t4, v_key, 'not_reported', '{"items":[]}');
  end loop;
  begin
    perform public.complete_paper_extraction(v_pa, 1, v_t4, 'openrouter', null);
    v_report := v_report || E'\nprovider without model: FAILED (accepted)';
  exception when raise_exception then
    v_report := v_report || E'\nprovider without model refused: ok';
  end;
  begin
    perform public.complete_paper_extraction(v_pa, 1, v_t4, null, 'test/model');
    v_report := v_report || E'\nmodel without provider: FAILED (accepted)';
  exception when raise_exception then
    v_report := v_report || E'\nmodel without provider refused: ok';
  end;
  begin
    perform public.complete_paper_extraction(v_pa, 1, v_t4, '   ', '   ');
    v_report := v_report || E'\nblank provider/model: FAILED (accepted)';
  exception when raise_exception then
    v_report := v_report || E'\nblank provider and model refused (not treated as NULL): ok';
  end;
  begin
    perform public.complete_paper_extraction(v_pa, 1, v_t4, 'openrouter', '  ');
    v_report := v_report || E'\nblank model: FAILED (accepted)';
  exception when raise_exception then
    v_report := v_report || E'\nblank model refused: ok';
  end;
  perform public.store_extraction_field(v_pa, 1, v_t4, 'concepts', 'failed', '{"items":[]}');
  begin
    perform public.complete_paper_extraction(v_pa, 1, v_t4, null, null);
    v_report := v_report || E'\nNULL/NULL with a failed field: FAILED (accepted)';
  exception when raise_exception then
    v_report := v_report || E'\nNULL/NULL with a failed field refused: ok';
  end;
  perform public.store_extraction_field(v_pa, 1, v_t4, 'concepts', 'not_reported', '{"items":[]}');
  perform public.store_extraction_field(v_pa, 1, v_t4, 'objective', 'extracted', '{"items":[{"text":"We study widgets."}]}', v_src);
  begin
    perform public.complete_paper_extraction(v_pa, 1, v_t4, null, null);
    v_report := v_report || E'\nNULL/NULL with an extracted field: FAILED (accepted)';
  exception when raise_exception then
    v_report := v_report || E'\nNULL/NULL with an extracted field refused: ok';
  end;
  reset role;

  -- a field left over from an EARLIER run (different marker) keeps this run 'partial'
  update public.paper_extraction_fields set claim_started_at = v_t4 - interval '1 minute'
   where paper_id = v_pa and schema_version = 1 and field_key = 'dataset';
  set local role service_role;
  select public.complete_paper_extraction(v_pa, 1, v_t4, 'openrouter', 'test/model') into v_txt;
  reset role;
  v_report := v_report || case when v_txt = 'partial'
    then E'\na field not written by this claim keeps the extraction partial, never complete: ok'
    else E'\nstale-field completion: FAILED (' || coalesce(v_txt, 'null') || ')' end;

  -- ======== P5: a real LLM completion records provider and model ===============================
  set local role authenticated;
  select public.request_paper_extraction(v_pa) into v_r;
  reset role;
  v_report := v_report || case when v_r = 'requested' then E'\npartial extraction: a request re-queues it: ok' else E'\npartial request: FAILED (' || v_r || ')' end;
  set local role service_role;
  select c.claim_started_at into v_t5 from public.claim_next_paper_extraction(1, 3) c;
  perform public.store_extraction_field(v_pa, 1, v_t5, 'objective', 'extracted', '{"items":[{"text":"We study widgets."}]}', v_src);
  foreach v_key in array array['methodology', 'dataset', 'findings', 'limitations', 'future_work', 'concepts'] loop
    perform public.store_extraction_field(v_pa, 1, v_t5, v_key, 'not_reported', '{"items":[]}');
  end loop;
  select public.complete_paper_extraction(v_pa, 1, v_t5, '  openrouter ', ' test/model ') into v_txt;
  reset role;
  select e.provider = 'openrouter' and e.model = 'test/model' into v_ok from public.paper_extractions e where e.paper_id = v_pa;
  v_report := v_report || case when v_txt = 'complete' and v_ok
    then E'\nseven current-run fields + an LLM: complete, trimmed provider and model recorded: ok' else E'\nLLM completion: FAILED (' || coalesce(v_txt, 'null') || ')' end;

  set local role authenticated;
  select public.request_paper_extraction(v_pa) into v_r;
  reset role;
  v_report := v_report || case when v_r = 'unchanged' then E'\ncomplete again: request is a no-op: ok' else E'\nsecond no-op: FAILED (' || v_r || ')' end;

  -- ======== P6: generation changes DURING a run =================================================
  update public.papers set processing_completed_at = v_t + interval '20 minutes' where id = v_pa;   -- g3
  set local role authenticated;
  select public.request_paper_extraction(v_pa) into v_r;
  reset role;
  set local role service_role;
  select c.claim_started_at into v_t6 from public.claim_next_paper_extraction(1, 3) c;
  perform public.store_extraction_field(v_pa, 1, v_t6, 'objective', 'not_reported', '{"items":[]}');
  reset role;
  update public.papers set processing_completed_at = v_t + interval '30 minutes' where id = v_pa;   -- g4 arrives mid-run
  set local role service_role;
  select public.store_extraction_field(v_pa, 1, v_t6, 'methodology', 'not_reported', '{"items":[]}') into v_ok;
  select public.complete_paper_extraction(v_pa, 1, v_t6, 'openrouter', 'test/model') into v_txt;
  v_report := v_report || case when v_ok is false and v_txt is null
    then E'\ngeneration change during a run: store and complete are refused: ok' else E'\ngeneration fence: FAILED' end;
  select public.retry_paper_extraction(v_pa, 1, v_t6) into v_ok;
  reset role;
  select count(*) into v_n from public.paper_extraction_fields where paper_id = v_pa;
  v_report := v_report || case when v_ok and v_n = 1
    then E'\nre-queueing after a generation change deletes nothing yet: ok' else E'\nearly delete: FAILED (' || v_n || ')' end;
  set local role service_role;
  select c.claim_started_at into v_t7 from public.claim_next_paper_extraction(1, 3) c;
  select public.store_extraction_field(v_pa, 1, v_t6, 'methodology', 'not_reported', '{"items":[]}') into v_ok;
  reset role;
  select count(*) into v_n from public.paper_extraction_fields where paper_id = v_pa;
  select e.source_completed_at = v_t + interval '30 minutes' into v_txt from public.paper_extractions e where e.paper_id = v_pa;
  v_report := v_report || case when v_t7 is not null and v_ok is false and v_n = 0 and v_txt = 'true'
    then E'\nnext claim resets to the new generation; the old token stays fenced: ok' else E'\nold token fence: FAILED' end;

  -- ======== P7: abandoned runs ===================================================================
  alter table public.paper_extractions disable trigger paper_extractions_updated_at;
  update public.paper_extractions set updated_at = now() - interval '30 minutes' where paper_id = v_pa;
  alter table public.paper_extractions enable trigger paper_extractions_updated_at;
  set local role service_role;
  select c.claim_started_at, c.attempts into v_t8, v_n from public.claim_next_paper_extraction(1, 3) c;
  select public.store_extraction_field(v_pa, 1, v_t7, 'objective', 'not_reported', '{"items":[]}') into v_ok;
  reset role;
  v_report := v_report || case when v_t8 is not null and v_t8 <> v_t7 and v_n = 2 and v_ok is false
    then E'\nabandoned run with attempts left is reclaimed (attempt 2); the old claim is fenced out: ok' else E'\nabandoned reclaim: FAILED' end;

  alter table public.paper_extractions disable trigger paper_extractions_updated_at;
  update public.paper_extractions set updated_at = now() - interval '30 minutes' where paper_id = v_pa;
  alter table public.paper_extractions enable trigger paper_extractions_updated_at;
  set local role service_role;
  select c.paper_id into v_paper from public.claim_next_paper_extraction(1, 2) c;   -- max 2 attempts, both used
  reset role;
  select e.status, e.last_error is not null into v_txt, v_ok from public.paper_extractions e where e.paper_id = v_pa;
  v_report := v_report || case when v_paper is null and v_txt = 'failed' and v_ok
    then E'\nexhausted abandoned run is failed, not reclaimed: ok' else E'\nabandoned exhaustion: FAILED (' || coalesce(v_txt, 'null') || ')' end;

  -- Two-worker claim safety cannot be shown in one transaction. Manual check (two SQL
  -- editor sessions, with one pending extraction): in session 1 run
  --   begin; select * from public.claim_next_paper_extraction(1, 3);   -- keep the transaction open
  -- then in session 2 run the same select: it must return no row (FOR UPDATE SKIP LOCKED),
  -- never the same paper. Roll session 1 back afterwards. Concurrent requests are safe by
  -- the same mechanism (INSERT ... ON CONFLICT DO NOTHING, then FOR UPDATE).

  raise exception E'REPORT (everything above is rolled back):%', v_report;
end;
$$;
