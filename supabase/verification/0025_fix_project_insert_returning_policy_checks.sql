-- Manual, read-only verification. Run in staging/production after applying 0025.
select policyname, cmd, qual
  from pg_policies
 where schemaname = 'public'
   and tablename = 'research_projects'
 order by policyname;
-- Expect "Members read projects" (SELECT) qual to read:
--   (user_id = ( SELECT auth.uid() AS uid)) OR can_view_project(id)

-- End-to-end reproduction (run as an authenticated user via the client, not
-- the SQL editor's own role): creating a project should now both succeed and
-- return its row in the same request.
-- insert into public.research_projects (title) values ('RLS fix check')
--   returning id, title, user_id;
