-- Manual verification for migration 0009 (Evidence Matrix foundation).
-- Run each numbered block separately in the Supabase SQL editor.
-- Blocks 1-3 are read-only. Block 4 builds throwaway fixtures inside a transaction and
-- ALWAYS rolls back (it ends by raising an error on purpose; the message is the report).
-- Nothing here calls an LLM or Voyage, creates accounts, or writes auth.users.

-- 1. Objects, RLS, PostgreSQL version, and the view runs as the caller.
select current_setting('server_version_num')::int >= 150000 as postgres_15_or_newer; -- expect true
select relname, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('paper_extractions', 'paper_extraction_fields', 'paper_extraction_sources')
order by relname;
-- expect: 3 rows, rls_enabled = true
select c.relname, c.reloptions
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relname = 'paper_extraction_overview';
-- expect: 1 row, reloptions contains security_invoker=true

-- 2. Privileges: browsers read only safe columns and write nothing; only service_role writes.
select
  has_table_privilege('authenticated', 'public.paper_extractions', 'insert')        as auth_insert_ext,     -- expect false
  has_table_privilege('authenticated', 'public.paper_extractions', 'update')        as auth_update_ext,     -- expect false
  has_table_privilege('authenticated', 'public.paper_extractions', 'delete')        as auth_delete_ext,     -- expect false
  has_table_privilege('authenticated', 'public.paper_extraction_fields', 'insert')  as auth_insert_fields,  -- expect false
  has_table_privilege('authenticated', 'public.paper_extraction_sources', 'insert') as auth_insert_sources, -- expect false
  has_column_privilege('authenticated', 'public.paper_extractions', 'status', 'select')           as auth_read_status,  -- expect true
  has_column_privilege('authenticated', 'public.paper_extractions', 'last_error', 'select')       as auth_read_error,   -- expect false
  has_column_privilege('authenticated', 'public.paper_extractions', 'claim_started_at', 'select') as auth_read_claim,   -- expect false
  has_column_privilege('authenticated', 'public.paper_extractions', 'attempts', 'select')         as auth_read_attempts,-- expect false
  has_column_privilege('authenticated', 'public.paper_extractions', 'user_id', 'select')          as auth_read_user,    -- expect false
  has_column_privilege('anon',          'public.paper_extractions', 'status', 'select')           as anon_read_status,  -- expect false
  has_table_privilege('service_role', 'public.paper_extractions', 'insert')                       as service_insert;    -- expect true

select p.proname,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_run, -- expect false
       has_function_privilege('anon',          p.oid, 'execute') as anon_can_run,          -- expect false
       has_function_privilege('service_role',  p.oid, 'execute') as service_role_can_run   -- expect true
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('claim_paper_extraction', 'store_extraction_field',
                    'complete_paper_extraction', 'fail_paper_extraction')
order by p.proname;
-- expect: 4 rows, false / false / true each

select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('paper_extractions', 'paper_extraction_fields', 'paper_extraction_sources')
order by tablename;
-- expect: exactly 3 rows, all SELECT

-- 3. Indexes: B-tree only, no vector/ANN index, and the applying changed no data.
select tablename, indexname from pg_indexes
where schemaname = 'public'
  and tablename in ('paper_extractions', 'paper_extraction_fields', 'paper_extraction_sources')
order by tablename, indexname;
-- expect: pkey / unique indexes plus paper_extractions_user_idx, paper_extractions_open_idx,
--         paper_extraction_sources_chunk_idx, paper_extraction_sources_section_idx
select count(*) as extractions from public.paper_extractions;   -- expect 0 before first use

-- 4. Behavior test on throwaway fixtures (rolls back; the error message is the report).
--    BEFORE RUNNING: set v_a and v_b to two DIFFERENT existing auth.users ids (no
--    accounts are created). Expect every line to end in "ok". Nothing is saved.
do $$
declare
  v_a uuid := '00000000-0000-0000-0000-00000000000a';  -- REPLACE: real auth.users id (user A)
  v_b uuid := '00000000-0000-0000-0000-00000000000b';  -- REPLACE: a DIFFERENT real auth.users id (user B)
  v_t timestamptz := now() - interval '1 hour';
  v_pa uuid := gen_random_uuid();   -- A's ready paper
  v_pb uuid := gen_random_uuid();   -- B's ready paper
  v_proj uuid := gen_random_uuid(); -- A's project containing PA
  v_sa uuid; v_sb uuid;             -- sections
  v_ca uuid := gen_random_uuid();   -- A's chunk
  v_cb uuid := gen_random_uuid();   -- B's chunk
  v_token timestamptz; v_token2 timestamptz;
  v_ok boolean; v_status text; v_n int; v_n2 int; v_n3 int; v_txt text; v_bool boolean;
  v_before_papers bigint; v_before_chunks bigint; v_before_projects bigint;
  v_key text;
  v_report text := '';
  v_claims text;
  v_excerpt constant text := 'masks fifteen percent of tokens';
  v_value constant jsonb := '{"items":[{"text":"Masks 15% of tokens."}]}';
  v_src jsonb;
begin
  if (select count(*) from auth.users u where u.id in (v_a, v_b)) <> 2 or v_a = v_b then
    raise exception 'REPORT: replace v_a and v_b at the top of this block with two different real auth.users ids';
  end if;

  select count(*) into v_before_papers from public.papers;
  select count(*) into v_before_chunks from public.paper_chunks;
  select count(*) into v_before_projects from public.research_projects;

  -- ---- fixtures (as the SQL editor's privileged role) ---------------------------------
  insert into public.papers (id, user_id, title, status, processing_completed_at, page_count) values
    (v_pa, v_a, 'Paper A', 'ready', v_t, 5),
    (v_pb, v_b, 'Paper B', 'ready', v_t, 5);
  insert into public.research_projects (id, user_id, title) values (v_proj, v_a, 'Project A');
  insert into public.paper_project_links (paper_id, project_id, user_id) values (v_pa, v_proj, v_a);
  insert into public.paper_sections (paper_id, user_id, position, title, section_type, text, page_start, page_end)
    values (v_pa, v_a, 0, 'Pre-training BERT', 'methods', 'body', 3, 4) returning id into v_sa;
  insert into public.paper_sections (paper_id, user_id, position, title, section_type, text)
    values (v_pb, v_b, 0, 'Other', 'methods', 'body') returning id into v_sb;
  insert into public.paper_chunks (id, paper_id, user_id, section_id, chunk_index, text, char_start, char_end, page_start, page_end) values
    (v_ca, v_pa, v_a, v_sa, 0, 'BERT ' || v_excerpt || ' at random during pre-training.', 0, 60, 3, 4),
    (v_cb, v_pb, v_b, v_sb, 0, 'Some chunk of the other tenant.', 0, 30, 1, 1);

  -- ---- write path as service_role: claim / fence / store / complete --------------------
  set local role service_role;
  select c.claim_started_at, c.attempts into v_token, v_n from public.claim_paper_extraction(v_pa, 1) c;
  reset role;
  v_report := v_report || case when v_token is not null and v_n = 1
    then E'\nservice_role claims a ready paper (attempt 1): ok' else E'\nclaim: FAILED' end;

  perform 1 from public.claim_paper_extraction(v_pa, 1);
  v_report := v_report || case when found then E'\nsecond claim of a running extraction: FAILED'
    else E'\nrunning extraction cannot be claimed twice: ok' end;

  select public.store_extraction_field(v_pa, 1, v_token - interval '1 second', 'objective', 'extracted', v_value) into v_ok;
  v_report := v_report || case when v_ok is false then E'\nwrong claim token is fenced out: ok' else E'\nfencing: FAILED' end;

  -- source with a verbatim excerpt; the snapshot must come from the chunk/section rows
  v_src := jsonb_build_array(jsonb_build_object('item_index', 0, 'ord', 0, 'chunk_id', v_ca, 'excerpt', v_excerpt));
  select public.store_extraction_field(v_pa, 1, v_token, 'objective', 'extracted', v_value, v_src) into v_ok;
  select s.section_title, s.page_start into v_txt, v_n
    from public.paper_extraction_sources s where s.paper_id = v_pa and s.field_key = 'objective';
  v_report := v_report || case when v_ok and v_txt = 'Pre-training BERT' and v_n = 3
    then E'\nstore extracted field + database-derived source snapshot: ok' else E'\nstore field: FAILED' end;

  -- invalid sources are rejected (each inside its own sub-transaction)
  begin
    perform public.store_extraction_field(v_pa, 1, v_token, 'objective', 'extracted', v_value,
      jsonb_build_array(jsonb_build_object('item_index', 0, 'chunk_id', v_ca, 'excerpt', 'text not in the chunk')));
    v_report := v_report || E'\nnon-verbatim excerpt: FAILED (accepted)';
  exception when raise_exception then
    v_report := v_report || E'\nnon-verbatim excerpt rejected: ok';
  end;
  begin
    perform public.store_extraction_field(v_pa, 1, v_token, 'objective', 'extracted', v_value,
      jsonb_build_array(jsonb_build_object('item_index', 0, 'chunk_id', v_cb)));
    v_report := v_report || E'\nsource chunk of another owner: FAILED (accepted)';
  exception when raise_exception then
    v_report := v_report || E'\nsource chunk of another owner rejected: ok';
  end;
  begin
    perform public.store_extraction_field(v_pa, 1, v_token, 'objective', 'extracted', v_value,
      jsonb_build_array(jsonb_build_object('item_index', 5, 'chunk_id', v_ca)));
    v_report := v_report || E'\nsource for a non-existent item: FAILED (accepted)';
  exception when raise_exception then
    v_report := v_report || E'\nsource for a non-existent item rejected: ok';
  end;
  begin
    perform public.store_extraction_field(v_pa, 1, v_token, 'findings', 'not_reported', '{"items":[]}', v_src);
    v_report := v_report || E'\nsources on a not_reported field: FAILED (accepted)';
  exception when raise_exception then
    v_report := v_report || E'\nonly extracted fields can carry sources: ok';
  end;

  -- table constraints: invalid key / state / value shapes
  begin
    perform public.store_extraction_field(v_pa, 1, v_token, 'bogus', 'extracted', v_value);
    v_report := v_report || E'\ninvalid field key: FAILED (accepted)';
  exception when check_violation then
    v_report := v_report || E'\ninvalid field key rejected: ok';
  end;
  begin
    perform public.store_extraction_field(v_pa, 1, v_token, 'findings', 'maybe', '{"items":[]}');
    v_report := v_report || E'\ninvalid field state: FAILED (accepted)';
  exception when check_violation then
    v_report := v_report || E'\ninvalid field state rejected: ok';
  end;
  begin
    perform public.store_extraction_field(v_pa, 1, v_token, 'findings', 'extracted', '{"items":[]}');
    v_report := v_report || E'\nextracted with no items: FAILED (accepted)';
  exception when check_violation then
    v_report := v_report || E'\nextracted with no items rejected: ok';
  end;
  begin
    perform public.store_extraction_field(v_pa, 1, v_token, 'findings', 'extracted', '{"items":"not an array"}');
    v_report := v_report || E'\nextracted with non-array items: FAILED (accepted)';
  exception when check_violation then
    v_report := v_report || E'\nextracted with non-array items rejected: ok';
  end;
  begin
    perform public.store_extraction_field(v_pa, 1, v_token, 'findings', 'not_reported', v_value);
    v_report := v_report || E'\nnot_reported with items: FAILED (accepted)';
  exception when check_violation then
    v_report := v_report || E'\nnot_reported with items rejected: ok';
  end;
  begin
    perform public.store_extraction_field(v_pa, 1, v_token, 'findings', 'extracted',
      jsonb_build_object('items', (select jsonb_agg(jsonb_build_object('text', 'x')) from generate_series(1, 13))));
    v_report := v_report || E'\n13 items: FAILED (accepted)';
  exception when check_violation then
    v_report := v_report || E'\nmore than 12 items rejected: ok';
  end;

  -- all seven keys accepted, then complete (status computed by the database)
  foreach v_key in array array['methodology', 'dataset', 'findings', 'limitations', 'future_work', 'concepts'] loop
    perform public.store_extraction_field(v_pa, 1, v_token, v_key, 'not_reported', '{"items":[]}');
  end loop;
  select count(*) into v_n from public.paper_extraction_fields where paper_id = v_pa and schema_version = 1;
  v_report := v_report || case when v_n = 7 then E'\nall seven field keys accepted: ok' else E'\nseven keys: FAILED (' || v_n || ')' end;

  select public.complete_paper_extraction(v_pa, 1, v_token - interval '1 second', 'openrouter', 'test/model') into v_status;
  v_report := v_report || case when v_status is null then E'\ncomplete with a wrong token is fenced out: ok' else E'\ncomplete fencing: FAILED' end;
  select public.complete_paper_extraction(v_pa, 1, v_token, 'openrouter', 'test/model') into v_status;
  v_report := v_report || case when v_status = 'complete' then E'\nall seven fields, none failed -> complete: ok' else E'\ncomplete: FAILED (' || coalesce(v_status, 'null') || ')' end;

  perform 1 from public.claim_paper_extraction(v_pa, 1);
  v_report := v_report || case when found then E'\nunchanged completed paper re-claimed: FAILED'
    else E'\nunchanged completed paper is not re-extracted: ok' end;

  -- duplicate identity / cross-owner relationships (as the privileged role)
  begin
    insert into public.paper_extractions (paper_id, schema_version, user_id, source_completed_at)
      values (v_pa, 1, v_a, v_t);
    v_report := v_report || E'\nduplicate extraction (paper, version): FAILED (accepted)';
  exception when unique_violation then
    v_report := v_report || E'\nduplicate extraction for the same paper/version prevented: ok';
  end;
  insert into public.paper_extractions (paper_id, schema_version, user_id, source_completed_at)
    values (v_pa, 2, v_a, v_t);
  v_report := v_report || E'\nanother schema_version for the same paper allowed: ok';
  begin
    insert into public.paper_extractions (paper_id, schema_version, user_id, source_completed_at)
      values (v_pa, 3, v_b, v_t);
    v_report := v_report || E'\nextraction owned by the wrong user: FAILED (accepted)';
  exception when foreign_key_violation then
    v_report := v_report || E'\nextraction for another owner\'s paper rejected: ok';
  end;
  begin
    insert into public.paper_extraction_fields (paper_id, schema_version, field_key, user_id, state)
      values (v_pa, 2, 'objective', v_b, 'not_reported');
    v_report := v_report || E'\nfield with the wrong owner: FAILED (accepted)';
  exception when foreign_key_violation then
    v_report := v_report || E'\nfield with the wrong owner rejected: ok';
  end;
  begin
    insert into public.paper_extraction_sources
      (paper_id, schema_version, field_key, user_id, item_index, ord, chunk_id, section_id, section_title, section_type)
      values (v_pa, 1, 'objective', v_a, 0, 3, v_cb, null, 'x', 'methods');
    v_report := v_report || E'\nsource pointing at another owner\'s chunk: FAILED (accepted)';
  exception when foreign_key_violation then
    v_report := v_report || E'\nsource pointing at another owner\'s chunk rejected: ok';
  end;
  delete from public.paper_extractions where paper_id = v_pa and schema_version = 2;

  -- ---- browser reads as user A ----------------------------------------------------------
  v_claims := json_build_object('sub', v_a, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  select count(*) into v_n from public.paper_extractions;
  select count(*) into v_n2 from public.paper_extraction_fields;
  v_report := v_report || case when v_n = 1 and v_n2 = 7 then E'\nowner reads their extraction and 7 fields: ok'
    else E'\nowner read: FAILED (' || v_n || '/' || v_n2 || ')' end;
  perform 1 from public.paper_extraction_sources where section_title = 'Pre-training BERT' and page_start = 3;
  v_report := v_report || case when found then E'\nowner reads the source snapshot: ok' else E'\nsource read: FAILED' end;
  select o.is_stale into v_bool from public.paper_extraction_overview o where o.paper_id = v_pa;
  v_report := v_report || case when v_bool is false then E'\noverview: current generation is not stale: ok' else E'\noverview: FAILED' end;

  begin
    perform e.last_error from public.paper_extractions e;
    v_report := v_report || E'\nlast_error readable: FAILED';
  exception when insufficient_privilege then
    v_report := v_report || E'\nlast_error hidden from browsers: ok';
  end;
  begin
    perform e.claim_started_at from public.paper_extractions e;
    v_report := v_report || E'\nclaim token readable: FAILED';
  exception when insufficient_privilege then
    v_report := v_report || E'\nclaim token hidden from browsers: ok';
  end;
  begin
    perform e.user_id, e.attempts from public.paper_extractions e;
    v_report := v_report || E'\nuser_id/attempts readable: FAILED';
  exception when insufficient_privilege then
    v_report := v_report || E'\nuser_id and attempts hidden from browsers: ok';
  end;
  begin
    insert into public.paper_extractions (paper_id, schema_version, user_id, source_completed_at) values (v_pa, 9, v_a, v_t);
    v_report := v_report || E'\nbrowser insert: FAILED';
  exception when insufficient_privilege then
    v_report := v_report || E'\nbrowser cannot insert extractions: ok';
  end;
  begin
    update public.paper_extractions set status = 'failed';
    v_report := v_report || E'\nbrowser update: FAILED';
  exception when insufficient_privilege then
    v_report := v_report || E'\nbrowser cannot update extractions: ok';
  end;
  begin
    delete from public.paper_extraction_fields;
    v_report := v_report || E'\nbrowser delete: FAILED';
  exception when insufficient_privilege then
    v_report := v_report || E'\nbrowser cannot delete fields: ok';
  end;
  begin
    insert into public.paper_extraction_sources (paper_id, schema_version, field_key, user_id, item_index, section_title, section_type)
      values (v_pa, 1, 'objective', v_a, 1, 'x', 'methods');
    v_report := v_report || E'\nbrowser insert of sources: FAILED';
  exception when insufficient_privilege then
    v_report := v_report || E'\nbrowser cannot write sources: ok';
  end;
  begin
    perform public.claim_paper_extraction(v_pa, 1);
    v_report := v_report || E'\nbrowser can run claim_paper_extraction: FAILED';
  exception when insufficient_privilege then
    v_report := v_report || E'\nbrowser cannot run the internal functions: ok';
  end;
  reset role;

  -- ---- tenant isolation: user B sees none of A's extraction data --------------------------
  v_claims := json_build_object('sub', v_b, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  set local role authenticated;
  select count(*) into v_n from public.paper_extractions;
  select count(*) into v_n2 from public.paper_extraction_fields;
  select count(*) into v_n3 from public.paper_extraction_sources;
  perform 1 from public.paper_extraction_overview;
  v_report := v_report || case when v_n = 0 and v_n2 = 0 and v_n3 = 0 and not found
    then E'\nother tenant sees no extraction data (tables and overview): ok' else E'\ntenant isolation: FAILED' end;
  reset role;

  -- ---- reprocessing: the generation changes and the chunks/sections are replaced -------------
  select count(*) into v_n from public.paper_extraction_sources where paper_id = v_pa;
  update public.papers set processing_completed_at = v_t + interval '5 minutes' where id = v_pa;
  delete from public.paper_sections where paper_id = v_pa;   -- cascades to chunks, as 0005 does

  select count(*), count(*) filter (where chunk_id is null and section_id is null
                                      and section_title = 'Pre-training BERT'
                                      and page_start = 3 and excerpt = v_excerpt)
    into v_n2, v_n
    from public.paper_extraction_sources where paper_id = v_pa;
  v_report := v_report || case when v_n2 >= 1 and v_n = v_n2
    then E'\nprovenance snapshot survives chunk/section deletion (pointers cleared): ok'
    else E'\nprovenance snapshot: FAILED (' || v_n || '/' || v_n2 || ')' end;

  v_claims := json_build_object('sub', v_a, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  set local role authenticated;
  select o.is_stale, o.status into v_bool, v_txt from public.paper_extraction_overview o where o.paper_id = v_pa and o.schema_version = 1;
  reset role;
  v_report := v_report || case when v_bool is true and v_txt = 'complete'
    then E'\nreprocessed paper: old extraction is observably stale (status left as-is): ok'
    else E'\nstaleness: FAILED' end;

  -- the next claim discards the old generation and starts fresh
  select c.claim_started_at, c.attempts into v_token, v_n from public.claim_paper_extraction(v_pa, 1) c;
  select count(*) into v_n2 from public.paper_extraction_fields where paper_id = v_pa and schema_version = 1;
  select count(*) into v_n3 from public.paper_extraction_sources where paper_id = v_pa;
  v_report := v_report || case when v_token is not null and v_n = 1 and v_n2 = 0 and v_n3 = 0
    then E'\nnew generation: old fields/sources discarded, fresh claim (attempt 1): ok'
    else E'\nnew generation claim: FAILED' end;
  select o.is_stale into v_bool from public.paper_extraction_overview o where o.paper_id = v_pa and o.schema_version = 1;
  v_report := v_report || case when v_bool is false then E'\nafter the claim the extraction matches the new generation: ok' else E'\nnew generation match: FAILED' end;

  -- a generation change WHILE running fences the writer out
  update public.papers set processing_completed_at = v_t + interval '10 minutes' where id = v_pa;
  select public.store_extraction_field(v_pa, 1, v_token, 'objective', 'not_reported', '{"items":[]}') into v_ok;
  v_report := v_report || case when v_ok is false then E'\nstore is refused after the paper changed generation: ok' else E'\ngeneration fence: FAILED' end;
  update public.papers set processing_completed_at = v_t + interval '5 minutes' where id = v_pa;

  -- partial: one field failed -> 'partial'; then failure + resumption
  select public.store_extraction_field(v_pa, 1, v_token, 'objective', 'failed', '{"items":[]}') into v_ok;
  select public.complete_paper_extraction(v_pa, 1, v_token, 'openrouter', 'test/model') into v_status;
  v_report := v_report || case when v_ok and v_status = 'partial' then E'\na failed field makes the extraction partial: ok' else E'\npartial: FAILED (' || coalesce(v_status, 'null') || ')' end;

  select c.claim_started_at, c.attempts into v_token, v_n from public.claim_paper_extraction(v_pa, 1) c;
  v_report := v_report || case when v_token is not null and v_n = 2 then E'\na partial extraction can be resumed: ok' else E'\nresume: FAILED' end;
  select public.fail_paper_extraction(v_pa, 1, v_token - interval '1 second', 'boom') into v_ok;
  v_report := v_report || case when v_ok is false then E'\nfail with a wrong token is fenced out: ok' else E'\nfail fencing: FAILED' end;
  select public.fail_paper_extraction(v_pa, 1, v_token, repeat('e', 900)) into v_ok;
  select e.status, char_length(e.last_error) into v_txt, v_n from public.paper_extractions e where e.paper_id = v_pa and e.schema_version = 1;
  v_report := v_report || case when v_ok and v_txt = 'failed' and v_n = 500 then E'\nfailure recorded, error truncated to 500 chars: ok' else E'\nfail: FAILED' end;

  -- an abandoned running extraction is reclaimable; the old token is fenced out
  select c.claim_started_at into v_token from public.claim_paper_extraction(v_pa, 1) c;
  alter table public.paper_extractions disable trigger paper_extractions_updated_at;
  update public.paper_extractions set updated_at = now() - interval '30 minutes' where paper_id = v_pa and schema_version = 1;
  alter table public.paper_extractions enable trigger paper_extractions_updated_at;
  select c.claim_started_at into v_token2 from public.claim_paper_extraction(v_pa, 1) c;
  select public.store_extraction_field(v_pa, 1, v_token, 'objective', 'not_reported', '{"items":[]}') into v_ok;
  v_report := v_report || case when v_token2 is not null and v_token2 <> v_token and v_ok is false
    then E'\nabandoned run reclaimed; the old claim is fenced out: ok' else E'\nstale reclaim: FAILED' end;

  -- ---- existing data is unaffected; deleting a paper removes its extraction data ---------------
  delete from public.papers where id = v_pa;
  select count(*) into v_n from public.paper_extractions where paper_id = v_pa;
  select count(*) into v_n2 from public.paper_extraction_sources where paper_id = v_pa;
  v_report := v_report || case when v_n = 0 and v_n2 = 0 then E'\ndeleting a paper removes its extraction rows: ok' else E'\npaper delete cascade: FAILED' end;

  delete from public.papers where id = v_pb;
  delete from public.research_projects where id = v_proj;
  select count(*) into v_n from public.papers;
  select count(*) into v_n2 from public.paper_chunks;
  select count(*) into v_n3 from public.research_projects;
  v_report := v_report || case when v_n = v_before_papers and v_n2 = v_before_chunks and v_n3 = v_before_projects
    then E'\nexisting papers, chunks and projects unchanged: ok' else E'\nexisting data: FAILED' end;

  raise exception E'REPORT (everything above is rolled back):%', v_report;
end;
$$;
