-- R12 manual, read-only verification. Run in staging after applying 0023.
select
  to_regclass('public.paper_pages') is not null as has_pages,
  to_regclass('public.paper_tables') is not null as has_tables,
  to_regclass('public.paper_facts') is not null as has_facts,
  has_table_privilege('authenticated', 'public.paper_pages', 'insert') as browser_can_insert_pages,
  has_table_privilege('authenticated', 'public.paper_tables', 'insert') as browser_can_insert_tables,
  has_table_privilege('authenticated', 'public.paper_facts', 'insert') as browser_can_insert_facts,
  has_table_privilege('authenticated', 'public.paper_pages', 'select') as browser_can_select_pages,
  has_function_privilege(
    'service_role',
    'public.complete_paper_processing(uuid, timestamptz, int, jsonb, jsonb, jsonb, jsonb, jsonb, text, numeric, text, text)',
    'execute'
  ) as service_role_can_complete,
  has_function_privilege(
    'authenticated',
    'public.complete_paper_processing(uuid, timestamptz, int, jsonb, jsonb, jsonb, jsonb, jsonb, text, numeric, text, text)',
    'execute'
  ) as browser_can_complete; -- must be false

-- Expect exactly one SELECT-only policy per new table, all using can_view_paper.
select policyname, tablename, cmd, qual
  from pg_policies
 where schemaname = 'public'
   and tablename in ('paper_pages', 'paper_tables', 'paper_facts')
 order by tablename, policyname;

-- Expect rowsecurity = true for all three.
select relname, relrowsecurity
  from pg_class
 where relname in ('paper_pages', 'paper_tables', 'paper_facts');

-- Spot-check: a signed-in user queries as themselves (run with the anon/authenticated
-- role and auth.uid() set via a real session, not as the service role) and should see
-- 0 rows for any paper they do not own and are not a collaborator on.
-- select count(*) from public.paper_facts where paper_id = '<some other user''s paper id>';
