-- Manual verification for R9 usage metering. All checks are read-only.

-- 1. The table is append-only to browser roles; only service_role can write.
select
  has_table_privilege('authenticated', 'public.usage_events', 'select') as auth_can_read, -- true
  has_table_privilege('authenticated', 'public.usage_events', 'insert') as auth_can_insert, -- false
  has_table_privilege('authenticated', 'public.usage_events', 'update') as auth_can_update, -- false
  has_table_privilege('authenticated', 'public.usage_events', 'delete') as auth_can_delete, -- false
  has_table_privilege('service_role', 'public.usage_events', 'insert') as service_can_insert; -- true

-- 2. Summary has no user-id parameter and is callable by authenticated users only.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_can_run,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_run
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname = 'get_my_usage_summary';

-- 3. Confirm the processing completion function still has service-role-only execute.
select has_function_privilege(
  'authenticated',
  'public.complete_paper_processing(uuid,timestamptz,integer,jsonb,jsonb)',
  'execute'
) as auth_can_complete, -- false
has_function_privilege(
  'service_role',
  'public.complete_paper_processing(uuid,timestamptz,integer,jsonb,jsonb)',
  'execute'
) as service_can_complete; -- true

-- 4. After a live run, inspect only the current user's rows through an authenticated
-- session and confirm duplicate idempotency keys cannot create two events:
-- select actor_user_id, event_type, feature, quantity, idempotency_key, created_at
--   from public.usage_events order by created_at desc limit 20;
