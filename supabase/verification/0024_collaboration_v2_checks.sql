-- R13 manual, read-only verification. Run in staging after applying 0024.
select
  to_regclass('public.discussions') is not null as has_discussions,
  to_regclass('public.comments') is not null as has_comments,
  to_regclass('public.mentions') is not null as has_mentions,
  to_regclass('public.assignments') is not null as has_assignments,
  to_regclass('public.notes') is not null as has_notes,
  to_regclass('public.notifications') is not null as has_notifications,
  has_table_privilege('authenticated', 'public.comments', 'insert') as browser_can_insert_comments, -- must be false
  has_table_privilege('authenticated', 'public.notifications', 'insert') as browser_can_insert_notifications, -- must be false
  has_function_privilege('authenticated', 'public.add_comment(uuid, text, uuid[])', 'execute') as browser_can_add_comment,
  has_function_privilege('authenticated', 'public.create_mentions_and_notify(uuid, uuid, uuid, uuid[])', 'execute') as browser_can_call_internal_helper; -- must be false

select relname, relrowsecurity
  from pg_class
 where relname in ('discussions', 'comments', 'mentions', 'assignments', 'notes', 'notifications');

select policyname, tablename, cmd, qual
  from pg_policies
 where schemaname = 'public'
   and tablename in ('discussions', 'comments', 'mentions', 'assignments', 'notes', 'notifications')
 order by tablename, policyname;

-- Expect all six R13 tables, plus project_activity, in the realtime publication.
select schemaname, tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime'
   and tablename in ('discussions', 'comments', 'notifications', 'assignments', 'notes', 'project_activity')
 order by tablename;

-- Spot-check: as a signed-in user with no membership in project X, both of
-- these should return 0 rows (run with that user's session, not service_role).
-- select count(*) from public.discussions where project_id = '<project X id>';
-- select count(*) from public.notifications where project_id = '<project X id>' and recipient_id <> auth.uid();
