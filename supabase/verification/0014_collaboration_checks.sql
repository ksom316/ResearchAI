-- R10 manual, read-only verification. Run in staging after applying 0014-0017.
select
  to_regclass('public.project_members') is not null as has_members,
  to_regclass('public.project_invitations') is not null as has_invitations,
  to_regclass('public.project_activity') is not null as has_activity,
  has_function_privilege('authenticated', 'public.accept_project_invitation(text)', 'execute') as authenticated_can_accept,
  has_table_privilege('authenticated', 'public.project_activity', 'insert') as browser_can_insert_activity,
  has_table_privilege('authenticated', 'public.project_invitations', 'insert') as browser_can_insert_invitation;

select policyname, tablename
  from pg_policies
 where schemaname = 'public'
   and tablename in ('research_projects', 'papers', 'paper_project_links', 'project_members', 'project_invitations', 'project_activity')
 order by tablename, policyname;

select id, bucket_id, name, public
  from storage.buckets
 where id = 'papers';
