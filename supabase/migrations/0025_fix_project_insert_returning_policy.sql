-- Fixes the same class of bug 0022 already fixed for papers, just missed for
-- research_projects.
--
-- "Members read projects" (0014) reads research_projects purely through
-- public.can_view_project(id), which checks public.project_members. The
-- OWNER row in project_members is populated by an AFTER INSERT trigger
-- (seed_project_owner, 0014) on research_projects itself. Postgres computes
-- an INSERT ... RETURNING row's visibility against SELECT policies using the
-- row as it stands when the row-level AFTER trigger queue for that row is
-- run - project_members' OWNER row does not exist yet at that point, so
-- can_view_project(id) is false and Postgres raises "new row violates
-- row-level security policy for table research_projects" for the RETURNING
-- row, even though the INSERT's own WITH CHECK (user_id = auth.uid())
-- already passed. This is why making createProject() send user_id
-- explicitly did not fix project creation: the INSERT policy was never the
-- one failing.
--
-- Fix, mirroring 0022's fix for papers exactly: add a direct ownership
-- predicate to the SELECT policy so the creator can see their own row
-- immediately, without depending on the trigger-created membership row.
-- Collaborator access via can_view_project(id) is kept, unchanged.
begin;

drop policy if exists "Members read projects" on public.research_projects;
create policy "Members read projects" on public.research_projects for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_view_project(id)
  );

commit;
