-- R10 operational attribution hooks.
begin;

create policy "Members read collaborator profiles" on public.profiles
  for select to authenticated using (
    exists (select 1 from public.project_members mine
             join public.project_members theirs on theirs.project_id = mine.project_id
            where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id)
  );

create or replace function public.record_paper_link_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.project_activity(project_id, actor_user_id, event_type, metadata)
  values (coalesce(new.project_id, old.project_id), coalesce(auth.uid(), new.user_id),
          case when tg_op = 'INSERT' then 'paper_added' else 'paper_removed' end,
          jsonb_build_object('paper_id', coalesce(new.paper_id, old.paper_id)));
  if tg_op = 'INSERT' then return new; else return old; end if;
end; $$;
drop trigger if exists paper_project_links_activity on public.paper_project_links;
create trigger paper_project_links_activity after insert or delete on public.paper_project_links
for each row execute function public.record_paper_link_activity();

create or replace function public.record_usage_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.project_id is not null and new.event_type = 'llm_request' then
    insert into public.project_activity(project_id, actor_user_id, event_type, metadata)
    values (new.project_id, new.actor_user_id, 'ai_feature_invoked', jsonb_build_object('feature', new.feature));
  end if;
  return new;
end; $$;
drop trigger if exists usage_events_activity on public.usage_events;
create trigger usage_events_activity after insert on public.usage_events
for each row execute function public.record_usage_activity();

commit;
