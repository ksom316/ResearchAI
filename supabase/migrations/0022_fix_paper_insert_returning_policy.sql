-- R10 made collaborator reads flow through can_view_paper(id). During
-- INSERT ... RETURNING, that helper re-queries papers before the new row is
-- visible to the policy expression, so an otherwise valid owner insert is
-- rejected by the SELECT policy. Keep the collaboration branch, but make
-- ownership a direct predicate so authenticated uploaders can read back the row.
begin;

drop policy if exists "Users read authorized papers" on public.papers;
create policy "Users read authorized papers"
  on public.papers for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
        from public.paper_project_links l
       where l.paper_id = papers.id
         and public.can_view_project(l.project_id)
    )
  );

-- The helper remains private API used by trusted policies/functions.
revoke all on function public.can_view_paper(uuid) from public, anon;
grant execute on function public.can_view_paper(uuid)
  to authenticated, service_role;

commit;
