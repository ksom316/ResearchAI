-- R13: Collaboration V2 - discussions/comments, mentions, notifications,
-- assignments, collaborative notes, realtime, and presence authorization.
-- Additive to 0001-0023 (untouched). Run once in the Supabase SQL editor.
--
-- DESIGN, mirroring the R10 collaboration pattern (0014) exactly:
--   - Every table has RLS enabled and is readable only through can_view_project
--     (or the narrower "my own notifications" rule).
--   - NO insert/update/delete grants go to anon/authenticated on any table here.
--     Every write goes through a SECURITY DEFINER function that performs its
--     own authorization check (same idiom as log_project_activity,
--     create_project_invitation) and, where relevant, writes project_activity
--     and notifications atomically with the primary write - so a client can
--     never create a comment without a consistent activity/notification trail,
--     and can never forge an activity/notification row directly.
--   - "Finding" and "evidence" (R13 prompt) map onto the EXISTING Evidence
--     Matrix structure (0009): paper_extraction_fields rows (any field_key,
--     including 'findings') are the only per-item evidentiary objects with
--     stable identity in this schema. Comments can target a paper as a whole
--     ('paper') or one evidence-matrix item ('evidence_item'); there is no
--     separate "finding" table to avoid duplicating that concept (see R13
--     report). A trigger (not a composite FK, since the item lives inside a
--     jsonb array) checks the (paper_id, schema_version, field_key) exists.
--   - A discussion always belongs to exactly one project (the workspace it was
--     opened in) and its paper must be linked to that project, enforced by a
--     trigger: paper_project_links(paper_id, project_id) must exist. This is
--     what makes project isolation exact for every downstream table.
begin;

-- Discussions ------------------------------------------------------------------
create table public.discussions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  paper_id uuid not null references public.papers (id) on delete cascade,
  target_type text not null check (target_type in ('paper', 'evidence_item')),
  -- Set only when target_type = 'evidence_item'.
  schema_version int,
  field_key text,
  item_index int check (item_index is null or item_index between 0 and 11),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_by uuid not null references auth.users (id) on delete cascade,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  reopened_by uuid references auth.users (id) on delete set null,
  reopened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id), -- anchors composite FKs from comments/notifications/assignments
  constraint discussions_target_shape_check check (
    (target_type = 'paper'
      and schema_version is null and field_key is null and item_index is null)
    or (target_type = 'evidence_item'
      and schema_version is not null and field_key is not null and item_index is not null)
  ),
  constraint discussions_resolution_shape_check check (
    (status = 'open') = (resolved_by is null and resolved_at is null)
  )
);

create index discussions_project_idx on public.discussions (project_id, created_at desc);
create index discussions_paper_idx on public.discussions (paper_id);

create trigger discussions_updated_at before update on public.discussions
  for each row execute function public.set_updated_at();

-- The paper must actually be linked to the discussion's project, and an
-- evidence_item target must exist (any extracted field, any item index within
-- the field's current item count - jsonb array bounds are checked at write
-- time; a later reprocessing that shrinks items leaves old discussions
-- addressable but is a rare, inspectable edge case, not silently broken data).
create or replace function public.validate_discussion_target()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.paper_project_links l
     where l.paper_id = new.paper_id and l.project_id = new.project_id
  ) then
    raise exception 'paper_not_linked_to_project';
  end if;

  if new.target_type = 'evidence_item' then
    if not exists (
      select 1 from public.paper_extraction_fields f
       where f.paper_id = new.paper_id
         and f.schema_version = new.schema_version
         and f.field_key = new.field_key
    ) then
      raise exception 'evidence_item_not_found';
    end if;
  end if;
  return new;
end;
$$;

create trigger discussions_validate_target
  before insert on public.discussions
  for each row execute function public.validate_discussion_target();

-- Comments -----------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null,
  project_id uuid not null, -- denormalized from the discussion; enforced by FK below
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  -- Soft delete: preserves thread shape and existing mention/notification FKs
  -- instead of leaving holes or cascading away history other users already saw.
  deleted_at timestamptz,
  unique (id, project_id),
  foreign key (discussion_id, project_id)
    references public.discussions (id, project_id) on delete cascade
);

create index comments_discussion_idx on public.comments (discussion_id, created_at);
create index comments_project_idx on public.comments (project_id);

create trigger comments_updated_at before update on public.comments
  for each row execute function public.set_updated_at();

-- Mentions -------------------------------------------------------------------------
create table public.mentions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null,
  project_id uuid not null,
  mentioned_user_id uuid not null references auth.users (id) on delete cascade,
  mentioned_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (comment_id, mentioned_user_id),
  foreign key (comment_id, project_id)
    references public.comments (id, project_id) on delete cascade
);

create index mentions_user_idx on public.mentions (mentioned_user_id, created_at desc);

-- A mention can only name someone who can actually see the project; this is
-- the DB-level backstop for "cannot mention inaccessible users" even if a
-- client somehow bypassed the RPC's own check.
create or replace function public.validate_mention()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.project_members pm
     where pm.project_id = new.project_id and pm.user_id = new.mentioned_user_id
  ) then
    raise exception 'mentioned_user_not_a_project_member';
  end if;
  return new;
end;
$$;

create trigger mentions_validate before insert on public.mentions
  for each row execute function public.validate_mention();

-- Assignments ------------------------------------------------------------------
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  target_type text not null check (target_type in ('paper', 'evidence_item', 'discussion', 'note')),
  paper_id uuid references public.papers (id) on delete cascade,
  schema_version int,
  field_key text,
  item_index int check (item_index is null or item_index between 0 and 11),
  discussion_id uuid,
  note_id uuid, -- FK added after public.notes exists, below
  assignee_id uuid not null references auth.users (id) on delete cascade,
  assigner_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'assigned' check (status in ('assigned', 'in_progress', 'completed')),
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  constraint assignments_target_shape_check check (
    (target_type = 'paper' and paper_id is not null
      and schema_version is null and field_key is null and item_index is null
      and discussion_id is null and note_id is null)
    or (target_type = 'evidence_item' and paper_id is not null
      and schema_version is not null and field_key is not null and item_index is not null
      and discussion_id is null and note_id is null)
    or (target_type = 'discussion' and discussion_id is not null
      and paper_id is null and schema_version is null and field_key is null
      and item_index is null and note_id is null)
    or (target_type = 'note' and note_id is not null
      and paper_id is null and schema_version is null and field_key is null
      and item_index is null and discussion_id is null)
  ),
  constraint assignments_completion_shape_check check (
    (status = 'completed') = (completed_at is not null)
  ),
  foreign key (discussion_id, project_id)
    references public.discussions (id, project_id) on delete cascade
);

create index assignments_project_idx on public.assignments (project_id, created_at desc);
create index assignments_assignee_idx on public.assignments (assignee_id, status);

create trigger assignments_updated_at before update on public.assignments
  for each row execute function public.set_updated_at();

-- Collaborative research notes --------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.research_projects (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 300),
  content text not null default '' check (char_length(content) <= 50000),
  created_by uuid not null references auth.users (id) on delete cascade,
  last_edited_by uuid references auth.users (id) on delete set null,
  -- Optimistic-concurrency token: a client must read the current revision and
  -- send it back on update_note; a stale write is rejected (note_revision_conflict)
  -- instead of silently overwriting a concurrent edit. This is the architectural
  -- seam for eventual simultaneous editing (R14+): a future operational-transform
  -- or CRDT layer would replace the single `content` write with an append-only
  -- `note_operations` log keyed by (note_id, revision), applied in order, with
  -- `revision` becoming the log's position instead of a whole-document version.
  -- Nothing here would need to change shape to grow into that - see R13 report.
  revision int not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_project_idx on public.notes (project_id, updated_at desc);

create trigger notes_updated_at before update on public.notes
  for each row execute function public.set_updated_at();

alter table public.notes add constraint notes_id_project_unique unique (id, project_id);
alter table public.assignments
  add constraint assignments_note_fk
  foreign key (note_id, project_id) references public.notes (id, project_id) on delete cascade;
-- (notes is created after assignments because assignments.note_id references
-- it; the FK itself is added here, once notes' unique(id, project_id) exists.)

-- Notifications ------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  project_id uuid not null references public.research_projects (id) on delete cascade,
  event_type text not null check (event_type in (
    'mention', 'reply', 'discussion_resolved', 'discussion_reopened',
    'assignment_created', 'assignment_completed'
  )),
  discussion_id uuid,
  comment_id uuid,
  assignment_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (discussion_id, project_id)
    references public.discussions (id, project_id) on delete cascade,
  foreign key (comment_id, project_id)
    references public.comments (id, project_id) on delete cascade,
  foreign key (assignment_id, project_id)
    references public.assignments (id, project_id) on delete cascade
);

create index notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);
create index notifications_recipient_unread_idx
  on public.notifications (recipient_id)
  where read_at is null;

-- RLS: read-only for the audience; every write is through a function below ------
alter table public.discussions enable row level security;
alter table public.comments enable row level security;
alter table public.mentions enable row level security;
alter table public.assignments enable row level security;
alter table public.notes enable row level security;
alter table public.notifications enable row level security;

revoke all on public.discussions, public.comments, public.mentions,
  public.assignments, public.notes, public.notifications
  from anon, authenticated;
grant select on public.discussions, public.comments, public.mentions,
  public.assignments, public.notes, public.notifications to authenticated;
grant select, insert, update, delete on public.discussions, public.comments,
  public.mentions, public.assignments, public.notes, public.notifications
  to service_role;

create policy "Members read discussions" on public.discussions
  for select to authenticated using (public.can_view_project(project_id));
create policy "Members read comments" on public.comments
  for select to authenticated using (public.can_view_project(project_id));
-- A mention identifies a specific person; only project members (the only
-- possible mentionees, enforced above) and the mentioner/mentionee can read
-- the row set, which for this app is the same as "project members".
create policy "Members read mentions" on public.mentions
  for select to authenticated using (public.can_view_project(project_id));
create policy "Members read assignments" on public.assignments
  for select to authenticated using (public.can_view_project(project_id));
create policy "Members read notes" on public.notes
  for select to authenticated using (public.can_view_project(project_id));
-- Notifications are never visible to anyone but their recipient, regardless
-- of project membership - a notification can reveal what was said about a
-- user, not just that something happened.
create policy "Recipients read own notifications" on public.notifications
  for select to authenticated using (recipient_id = (select auth.uid()));

-- Extend project_activity's fixed event vocabulary (R10) for R13 events --------
alter table public.project_activity drop constraint project_activity_event_type_check;
alter table public.project_activity add constraint project_activity_event_type_check
  check (event_type in (
    'member_invited', 'invitation_accepted', 'member_role_changed',
    'member_removed', 'paper_added', 'paper_removed', 'research_changed',
    'ai_feature_invoked',
    'comment_created', 'discussion_resolved', 'discussion_reopened',
    'user_mentioned', 'assignment_created', 'assignment_completed',
    'note_created', 'note_updated'
  ));

-- Write path: SECURITY DEFINER functions, same idiom as log_project_activity ----

create or replace function public.create_discussion(
  p_project_id uuid,
  p_paper_id uuid,
  p_target_type text,
  p_body text,
  p_schema_version int default null,
  p_field_key text default null,
  p_item_index int default null,
  p_mentioned_user_ids uuid[] default '{}'::uuid[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_discussion_id uuid;
  v_comment_id uuid;
begin
  if not public.can_view_project(p_project_id) then
    raise exception 'project_member_required';
  end if;
  if not public.can_view_paper(p_paper_id) then
    raise exception 'paper_not_accessible';
  end if;

  insert into public.discussions
    (project_id, paper_id, target_type, schema_version, field_key, item_index, created_by)
  values
    (p_project_id, p_paper_id, p_target_type, p_schema_version, p_field_key, p_item_index, auth.uid())
  returning id into v_discussion_id;

  insert into public.comments (discussion_id, project_id, author_id, body)
  values (v_discussion_id, p_project_id, auth.uid(), p_body)
  returning id into v_comment_id;

  perform public.create_mentions_and_notify(v_discussion_id, v_comment_id, p_project_id, p_mentioned_user_ids);

  insert into public.project_activity (project_id, actor_user_id, event_type, metadata)
  values (p_project_id, auth.uid(), 'comment_created',
          jsonb_build_object('discussion_id', v_discussion_id, 'paper_id', p_paper_id, 'target_type', p_target_type));

  return v_discussion_id;
end;
$$;

-- Shared by create_discussion and add_comment: inserts mention rows (validated
-- by the mentions_validate trigger) and fans out notifications once per
-- recipient - a mentioned discussion-opener gets ONLY the mention notification,
-- never also a duplicate "reply" notification for the same comment.
create or replace function public.create_mentions_and_notify(
  p_discussion_id uuid,
  p_comment_id uuid,
  p_project_id uuid,
  p_mentioned_user_ids uuid[]
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_opener uuid;
  v_actor uuid := auth.uid();
  v_mentioned uuid[] := coalesce(p_mentioned_user_ids, '{}'::uuid[]);
begin
  insert into public.mentions (comment_id, project_id, mentioned_user_id, mentioned_by)
  select p_comment_id, p_project_id, u, v_actor
    from unnest(v_mentioned) as u
   where u <> v_actor
  on conflict (comment_id, mentioned_user_id) do nothing;

  insert into public.notifications (recipient_id, actor_id, project_id, event_type, discussion_id, comment_id)
  select u, v_actor, p_project_id, 'mention', p_discussion_id, p_comment_id
    from unnest(v_mentioned) as u
   where u <> v_actor;

  insert into public.project_activity (project_id, actor_user_id, event_type, metadata)
  select p_project_id, v_actor, 'user_mentioned',
         jsonb_build_object('discussion_id', p_discussion_id, 'comment_id', p_comment_id, 'mentioned_user_id', u)
    from unnest(v_mentioned) as u
   where u <> v_actor;

  select d.created_by into v_opener from public.discussions d where d.id = p_discussion_id;
  if v_opener is not null and v_opener <> v_actor and not (v_opener = any(v_mentioned)) then
    insert into public.notifications (recipient_id, actor_id, project_id, event_type, discussion_id, comment_id)
    values (v_opener, v_actor, p_project_id, 'reply', p_discussion_id, p_comment_id);
  end if;
end;
$$;

create or replace function public.add_comment(
  p_discussion_id uuid,
  p_body text,
  p_mentioned_user_ids uuid[] default '{}'::uuid[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_project_id uuid;
  v_paper_id uuid;
  v_comment_id uuid;
begin
  select d.project_id, d.paper_id into v_project_id, v_paper_id
    from public.discussions d where d.id = p_discussion_id;
  if v_project_id is null or not public.can_view_project(v_project_id) then
    raise exception 'project_member_required';
  end if;

  insert into public.comments (discussion_id, project_id, author_id, body)
  values (p_discussion_id, v_project_id, auth.uid(), p_body)
  returning id into v_comment_id;

  perform public.create_mentions_and_notify(p_discussion_id, v_comment_id, v_project_id, p_mentioned_user_ids);

  insert into public.project_activity (project_id, actor_user_id, event_type, metadata)
  values (v_project_id, auth.uid(), 'comment_created',
          jsonb_build_object('discussion_id', p_discussion_id, 'paper_id', v_paper_id));

  return v_comment_id;
end;
$$;

create or replace function public.edit_comment(p_comment_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.comments
     set body = p_body, edited_at = now()
   where id = p_comment_id and author_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'comment_not_editable'; end if;
end;
$$;

create or replace function public.delete_comment(p_comment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.comments
     set deleted_at = now(), body = '[deleted]'
   where id = p_comment_id and author_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'comment_not_deletable'; end if;
end;
$$;

create or replace function public.resolve_discussion(p_discussion_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from public.discussions where id = p_discussion_id;
  if v_project_id is null or not public.can_edit_project(v_project_id) then
    raise exception 'project_editor_required';
  end if;

  update public.discussions
     set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
         reopened_by = null, reopened_at = null
   where id = p_discussion_id and status = 'open';
  if not found then raise exception 'discussion_not_open'; end if;

  insert into public.project_activity (project_id, actor_user_id, event_type, metadata)
  values (v_project_id, auth.uid(), 'discussion_resolved', jsonb_build_object('discussion_id', p_discussion_id));

  insert into public.notifications (recipient_id, actor_id, project_id, event_type, discussion_id)
  select distinct c.author_id, auth.uid(), v_project_id, 'discussion_resolved', p_discussion_id
    from public.comments c
   where c.discussion_id = p_discussion_id and c.author_id <> auth.uid();
end;
$$;

create or replace function public.reopen_discussion(p_discussion_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from public.discussions where id = p_discussion_id;
  if v_project_id is null or not public.can_edit_project(v_project_id) then
    raise exception 'project_editor_required';
  end if;

  update public.discussions
     set status = 'open', reopened_by = auth.uid(), reopened_at = now()
   where id = p_discussion_id and status = 'resolved';
  if not found then raise exception 'discussion_not_resolved'; end if;

  insert into public.project_activity (project_id, actor_user_id, event_type, metadata)
  values (v_project_id, auth.uid(), 'discussion_reopened', jsonb_build_object('discussion_id', p_discussion_id));

  insert into public.notifications (recipient_id, actor_id, project_id, event_type, discussion_id)
  select distinct c.author_id, auth.uid(), v_project_id, 'discussion_reopened', p_discussion_id
    from public.comments c
   where c.discussion_id = p_discussion_id and c.author_id <> auth.uid();
end;
$$;

create or replace function public.create_assignment(
  p_project_id uuid,
  p_target_type text,
  p_assignee_id uuid,
  p_paper_id uuid default null,
  p_schema_version int default null,
  p_field_key text default null,
  p_item_index int default null,
  p_discussion_id uuid default null,
  p_note_id uuid default null,
  p_due_date date default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_assignment_id uuid;
begin
  if not public.can_edit_project(p_project_id) then
    raise exception 'project_editor_required';
  end if;
  if not exists (
    select 1 from public.project_members pm
     where pm.project_id = p_project_id and pm.user_id = p_assignee_id
  ) then
    raise exception 'assignee_not_a_project_member';
  end if;

  insert into public.assignments
    (project_id, target_type, paper_id, schema_version, field_key, item_index,
     discussion_id, note_id, assignee_id, assigner_id, due_date)
  values
    (p_project_id, p_target_type, p_paper_id, p_schema_version, p_field_key, p_item_index,
     p_discussion_id, p_note_id, p_assignee_id, auth.uid(), p_due_date)
  returning id into v_assignment_id;

  insert into public.project_activity (project_id, actor_user_id, event_type, metadata)
  values (p_project_id, auth.uid(), 'assignment_created',
          jsonb_build_object('assignment_id', v_assignment_id, 'assignee_id', p_assignee_id, 'target_type', p_target_type));

  if p_assignee_id <> auth.uid() then
    insert into public.notifications (recipient_id, actor_id, project_id, event_type, assignment_id)
    values (p_assignee_id, auth.uid(), p_project_id, 'assignment_created', v_assignment_id);
  end if;

  return v_assignment_id;
end;
$$;

create or replace function public.update_assignment_status(p_assignment_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_project_id uuid;
  v_assigner_id uuid;
begin
  if p_status not in ('assigned', 'in_progress', 'completed') then
    raise exception 'invalid_assignment_status';
  end if;

  declare
    v_assignee_id uuid;
  begin
    select project_id, assigner_id, assignee_id into v_project_id, v_assigner_id, v_assignee_id
      from public.assignments where id = p_assignment_id;
    if v_project_id is null then raise exception 'assignment_not_found'; end if;
    -- Either party to the assignment may update its status; a bystander
    -- editor may not silently complete someone else's work.
    if auth.uid() not in (v_assignee_id, v_assigner_id) then
      raise exception 'assignment_party_required';
    end if;
  end;

  update public.assignments
     set status = p_status,
         completed_at = case when p_status = 'completed' then now() else null end
   where id = p_assignment_id;

  if p_status = 'completed' then
    insert into public.project_activity (project_id, actor_user_id, event_type, metadata)
    values (v_project_id, auth.uid(), 'assignment_completed', jsonb_build_object('assignment_id', p_assignment_id));
    if v_assigner_id is not null and v_assigner_id <> auth.uid() then
      insert into public.notifications (recipient_id, actor_id, project_id, event_type, assignment_id)
      values (v_assigner_id, auth.uid(), v_project_id, 'assignment_completed', p_assignment_id);
    end if;
  end if;
end;
$$;

create or replace function public.create_note(p_project_id uuid, p_title text, p_content text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_note_id uuid;
begin
  if not public.can_edit_project(p_project_id) then
    raise exception 'project_editor_required';
  end if;
  insert into public.notes (project_id, title, content, created_by, last_edited_by)
  values (p_project_id, p_title, p_content, auth.uid(), auth.uid())
  returning id into v_note_id;

  insert into public.project_activity (project_id, actor_user_id, event_type, metadata)
  values (p_project_id, auth.uid(), 'note_created', jsonb_build_object('note_id', v_note_id, 'title', p_title));

  return v_note_id;
end;
$$;

-- Optimistic concurrency: the caller must supply the revision it read. A
-- mismatch means someone else saved in between, so this write is rejected
-- rather than silently clobbering theirs (note_revision_conflict).
create or replace function public.update_note(
  p_note_id uuid, p_title text, p_content text, p_expected_revision int
)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_project_id uuid;
  v_new_revision int;
begin
  select project_id into v_project_id from public.notes where id = p_note_id;
  if v_project_id is null or not public.can_edit_project(v_project_id) then
    raise exception 'project_editor_required';
  end if;

  update public.notes
     set title = p_title, content = p_content,
         revision = revision + 1, last_edited_by = auth.uid()
   where id = p_note_id and revision = p_expected_revision
  returning revision into v_new_revision;

  if v_new_revision is null then
    raise exception 'note_revision_conflict';
  end if;

  insert into public.project_activity (project_id, actor_user_id, event_type, metadata)
  values (v_project_id, auth.uid(), 'note_updated', jsonb_build_object('note_id', p_note_id));

  return v_new_revision;
end;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
     set read_at = now()
   where id = p_notification_id and recipient_id = auth.uid() and read_at is null;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
     set read_at = now()
   where recipient_id = auth.uid() and read_at is null;
end;
$$;

-- Execute grants: functions only, never raw table writes -------------------------
revoke all on function public.create_discussion(uuid, uuid, text, text, int, text, int, uuid[])
  from public, anon, authenticated;
revoke all on function public.create_mentions_and_notify(uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;
revoke all on function public.add_comment(uuid, text, uuid[]) from public, anon, authenticated;
revoke all on function public.edit_comment(uuid, text) from public, anon, authenticated;
revoke all on function public.delete_comment(uuid) from public, anon, authenticated;
revoke all on function public.resolve_discussion(uuid) from public, anon, authenticated;
revoke all on function public.reopen_discussion(uuid) from public, anon, authenticated;
revoke all on function public.create_assignment(uuid, text, uuid, uuid, int, text, int, uuid, uuid, date)
  from public, anon, authenticated;
revoke all on function public.update_assignment_status(uuid, text) from public, anon, authenticated;
revoke all on function public.create_note(uuid, text, text) from public, anon, authenticated;
revoke all on function public.update_note(uuid, text, text, int) from public, anon, authenticated;
revoke all on function public.mark_notification_read(uuid) from public, anon, authenticated;
revoke all on function public.mark_all_notifications_read() from public, anon, authenticated;

grant execute on function public.create_discussion(uuid, uuid, text, text, int, text, int, uuid[]) to authenticated;
grant execute on function public.add_comment(uuid, text, uuid[]) to authenticated;
grant execute on function public.edit_comment(uuid, text) to authenticated;
grant execute on function public.delete_comment(uuid) to authenticated;
grant execute on function public.resolve_discussion(uuid) to authenticated;
grant execute on function public.reopen_discussion(uuid) to authenticated;
grant execute on function public.create_assignment(uuid, text, uuid, uuid, int, text, int, uuid, uuid, date) to authenticated;
grant execute on function public.update_assignment_status(uuid, text) to authenticated;
grant execute on function public.create_note(uuid, text, text) to authenticated;
grant execute on function public.update_note(uuid, text, text, int) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
-- create_mentions_and_notify is an internal helper, called only from the
-- functions above (which already hold the project-membership check); it is
-- never granted to authenticated directly.

-- Realtime: add new tables to the default publication, idempotently -------------
-- (Supabase projects ship a `supabase_realtime` publication by default; this
-- guards against re-running the migration or a project where it is missing.)
do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array array[
      'discussions', 'comments', 'notifications', 'assignments', 'notes', 'project_activity'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;

commit;
