-- ResearchAI R10: private project collaboration.
-- Membership is the authorization boundary; papers remain owned by the user who
-- uploaded them and are visible through a project only while linked to it.
begin;

create table public.project_members (
  project_id uuid not null references public.research_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('OWNER', 'EDITOR', 'VIEWER')),
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members(user_id, joined_at desc);

create table public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null check (recipient_email = lower(trim(recipient_email))),
  role text not null check (role in ('EDITOR', 'VIEWER')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index project_invitations_pending_unique
  on public.project_invitations(project_id, recipient_email)
  where status = 'pending';

create table public.project_activity (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.research_projects(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text,
  event_type text not null check (event_type in (
    'member_invited', 'invitation_accepted', 'member_role_changed',
    'member_removed', 'paper_added', 'paper_removed', 'research_changed',
    'ai_feature_invoked'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index project_activity_project_created_idx
  on public.project_activity(project_id, created_at desc);

insert into public.project_members(project_id, user_id, role)
select id, user_id, 'OWNER' from public.research_projects
on conflict (project_id, user_id) do update set role = 'OWNER';

create or replace function public.seed_project_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.project_members(project_id, user_id, role) values (new.id, new.user_id, 'OWNER');
  return new;
end; $$;
drop trigger if exists research_projects_seed_owner on public.research_projects;
create trigger research_projects_seed_owner after insert on public.research_projects
for each row execute function public.seed_project_owner();

create or replace function public.project_role(p_project_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select pm.role
    from public.project_members pm
   where pm.project_id = p_project_id and pm.user_id = (select auth.uid())
$$;

create or replace function public.can_view_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members pm
                  where pm.project_id = p_project_id and pm.user_id = (select auth.uid()))
$$;

create or replace function public.can_edit_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members pm
                  where pm.project_id = p_project_id
                    and pm.user_id = (select auth.uid())
                    and pm.role in ('OWNER', 'EDITOR'))
$$;

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members pm
                  where pm.project_id = p_project_id and pm.user_id = (select auth.uid())
                    and pm.role = 'OWNER')
$$;

create or replace function public.can_view_paper(p_paper_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.papers p
    where p.id = p_paper_id and (
      p.user_id = (select auth.uid()) or exists (
        select 1 from public.paper_project_links l
        where l.paper_id = p.id and public.can_view_project(l.project_id)
      )
    )
  )
$$;

create or replace function public.create_project_invitation(p_project_id uuid, p_email text, p_role text)
returns table (invitation_id uuid, invitation_token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_id uuid;
begin
  if not public.is_project_owner(p_project_id) then raise exception 'project_owner_required'; end if;
  if v_email = lower(coalesce(auth.jwt() ->> 'email', '')) then raise exception 'cannot_invite_self'; end if;
  if p_role not in ('EDITOR', 'VIEWER') then raise exception 'invalid_project_role'; end if;
  if exists (select 1 from public.project_members pm join auth.users u on u.id = pm.user_id
             where pm.project_id = p_project_id and lower(u.email) = v_email) then
    raise exception 'already_project_member';
  end if;
  insert into public.project_invitations(project_id, invited_by, recipient_email, role, token_hash)
  values (p_project_id, auth.uid(), v_email, p_role, encode(digest(v_token, 'sha256'), 'hex'))
  returning id into v_id;
  insert into public.project_activity(project_id, actor_user_id, event_type, metadata)
  values (p_project_id, auth.uid(), 'member_invited', jsonb_build_object('email', v_email, 'role', p_role));
  return query select v_id, v_token;
exception when unique_violation then
  raise exception 'pending_invitation_exists';
end;
$$;

create or replace function public.accept_project_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.project_invitations%rowtype;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select * into v_inv from public.project_invitations
   where token_hash = encode(digest(p_token, 'sha256'), 'hex') for update;
  if not found or v_inv.status <> 'pending' or v_inv.expires_at <= now() then
    if found and v_inv.status = 'pending' and v_inv.expires_at <= now() then
      update public.project_invitations set status = 'expired' where id = v_inv.id;
    end if;
    raise exception 'invitation_unavailable';
  end if;
  if v_inv.recipient_email <> v_email then raise exception 'invitation_email_mismatch'; end if;
  insert into public.project_members(project_id, user_id, role)
  values (v_inv.project_id, auth.uid(), v_inv.role)
  on conflict (project_id, user_id) do update set role = excluded.role;
  update public.project_invitations
     set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
   where id = v_inv.id;
  insert into public.project_activity(project_id, actor_user_id, event_type, metadata)
  values (v_inv.project_id, auth.uid(), 'invitation_accepted', jsonb_build_object('role', v_inv.role));
  return v_inv.project_id;
end;
$$;

create or replace function public.log_project_activity(
  p_project_id uuid, p_event_type text, p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_edit_project(p_project_id) then raise exception 'project_editor_required'; end if;
  insert into public.project_activity(project_id, actor_user_id, event_type, metadata)
  values (p_project_id, auth.uid(), p_event_type, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

-- Replace owner-only policies with centralized membership checks.
drop policy if exists "Users manage own projects" on public.research_projects;
create policy "Members read projects" on public.research_projects for select to authenticated
  using (public.can_view_project(id));
create policy "Users create projects" on public.research_projects for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Owners update projects" on public.research_projects for update to authenticated
  using (public.is_project_owner(id)) with check (public.is_project_owner(id));
create policy "Owners delete projects" on public.research_projects for delete to authenticated
  using (public.is_project_owner(id));

drop policy if exists "Users manage own papers" on public.papers;
create policy "Users read authorized papers" on public.papers for select to authenticated
  using (public.can_view_paper(id));
create policy "Users insert own papers" on public.papers for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Users update own papers" on public.papers for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Users delete own papers" on public.papers for delete to authenticated
  using (user_id = (select auth.uid()));

-- A link records the actor who created it, not the paper owner. Remove the old
-- same-owner composite FKs so an editor may link their own upload to a shared project.
alter table public.paper_project_links drop constraint if exists paper_project_links_paper_id_user_id_fkey;
alter table public.paper_project_links drop constraint if exists paper_project_links_project_id_user_id_fkey;
alter table public.paper_project_links add constraint paper_project_links_paper_id_fkey
  foreign key (paper_id) references public.papers(id) on delete cascade;
alter table public.paper_project_links add constraint paper_project_links_project_id_fkey
  foreign key (project_id) references public.research_projects(id) on delete cascade;
drop policy if exists "Users read own paper links" on public.paper_project_links;
drop policy if exists "Users create own paper links" on public.paper_project_links;
drop policy if exists "Users delete own paper links" on public.paper_project_links;
create policy "Members read paper links" on public.paper_project_links for select to authenticated
  using (public.can_view_project(project_id));
create policy "Editors create paper links" on public.paper_project_links for insert to authenticated
  with check (public.can_edit_project(project_id) and user_id = (select auth.uid())
    and exists (select 1 from public.papers p where p.id = paper_id and p.user_id = (select auth.uid())));
create policy "Editors delete paper links" on public.paper_project_links for delete to authenticated
  using (public.can_edit_project(project_id));

drop policy if exists "Users read own paper sections" on public.paper_sections;
drop policy if exists "Users read own paper chunks" on public.paper_chunks;
create policy "Members read paper sections" on public.paper_sections for select to authenticated
  using (public.can_view_paper(paper_id));
create policy "Members read paper chunks" on public.paper_chunks for select to authenticated
  using (public.can_view_paper(paper_id));

drop policy if exists "Users read own extractions" on public.paper_extractions;
drop policy if exists "Users read own extraction fields" on public.paper_extraction_fields;
drop policy if exists "Users read own extraction sources" on public.paper_extraction_sources;
create policy "Members read extractions" on public.paper_extractions for select to authenticated
  using (public.can_view_paper(paper_id));
create policy "Members read extraction fields" on public.paper_extraction_fields for select to authenticated
  using (public.can_view_paper(paper_id));
create policy "Members read extraction sources" on public.paper_extraction_sources for select to authenticated
  using (public.can_view_paper(paper_id));

alter table public.project_members enable row level security;
alter table public.project_invitations enable row level security;
alter table public.project_activity enable row level security;
revoke all on public.project_members, public.project_invitations, public.project_activity from anon, authenticated;
grant select on public.project_members, public.project_invitations, public.project_activity to authenticated;
grant update, delete on public.project_members to authenticated;
create policy "Members read membership" on public.project_members for select to authenticated
  using (public.can_view_project(project_id));
create policy "Owners manage membership" on public.project_members for all to authenticated
  using (public.is_project_owner(project_id) and role <> 'OWNER')
  with check (public.is_project_owner(project_id) and role in ('EDITOR', 'VIEWER'));
create policy "Owners read invitations" on public.project_invitations for select to authenticated
  using (public.is_project_owner(project_id));
create policy "Recipients read invitations" on public.project_invitations for select to authenticated
  using (recipient_email = lower(coalesce(auth.jwt() ->> 'email', '')) and status = 'pending');
create policy "Members read activity" on public.project_activity for select to authenticated
  using (public.can_view_project(project_id));

revoke all on function public.create_project_invitation(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_project_invitation(uuid, text, text) to authenticated;
revoke all on function public.accept_project_invitation(text) from public, anon, authenticated;
grant execute on function public.accept_project_invitation(text) to authenticated;
revoke all on function public.log_project_activity(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.log_project_activity(uuid, text, jsonb) to authenticated;
revoke all on function public.project_role(uuid) from public, anon;
revoke all on function public.can_view_project(uuid) from public, anon;
revoke all on function public.can_edit_project(uuid) from public, anon;
revoke all on function public.is_project_owner(uuid) from public, anon;
grant execute on function public.project_role(uuid) to authenticated;
grant execute on function public.can_view_project(uuid) to authenticated;
grant execute on function public.can_edit_project(uuid) to authenticated;

-- Existing storage objects remain private, but linked collaborators may read only
-- the object belonging to a paper visible through one shared project.
drop policy if exists "Users read own paper files" on storage.objects;
create policy "Members read linked paper files" on storage.objects for select to authenticated
  using (bucket_id = 'papers' and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (select 1 from public.papers p join public.paper_project_links l on l.paper_id = p.id
              where p.storage_path = name and public.can_view_project(l.project_id))
  ));

-- Search RPCs must accept a shared project, but never expand a user's private library.
create or replace function public.search_scope_paper_ids(
  p_paper_ids uuid[] default null, p_project_id uuid default null
) returns setof uuid language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_ids uuid[];
begin
  if v_uid is null then raise exception 'search_unauthenticated' using errcode = '28000'; end if;
  if p_project_id is not null and not public.can_view_project(p_project_id) then
    raise exception 'search_scope_not_found' using errcode = 'P0002';
  end if;
  if p_paper_ids is not null then
    select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids from unnest(p_paper_ids) x;
    if cardinality(v_ids) < 1 or cardinality(v_ids) > 50 then raise exception 'search_invalid_argument'; end if;
    if exists (select 1 from unnest(v_ids) x where not public.can_view_paper(x)) then
      raise exception 'search_scope_not_found' using errcode = 'P0002';
    end if;
  end if;
  return query select p.id from public.papers p
   where public.can_view_paper(p.id) and (v_ids is null or p.id = any(v_ids))
     and (p_project_id is null or exists (select 1 from public.paper_project_links l
          where l.paper_id = p.id and l.project_id = p_project_id));
end; $$;

commit;
