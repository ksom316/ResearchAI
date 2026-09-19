-- ResearchAI Phase 2.5: many-to-many papers <-> projects, plus per-user content hashing.
-- Additive to 0001/0002, which are untouched. Run once in the Supabase SQL editor.
begin;

-- Composite keys so the junction table can enforce same-owner links via FKs.
alter table public.papers
  add constraint papers_id_user_id_key unique (id, user_id);
alter table public.research_projects
  add constraint research_projects_id_user_id_key unique (id, user_id);

-- Junction table ---------------------------------------------------------------
create table public.paper_project_links (
  paper_id uuid not null,
  project_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (paper_id, project_id),
  -- Both sides must belong to user_id, so a link can never cross accounts.
  foreign key (paper_id, user_id)
    references public.papers (id, user_id) on delete cascade,
  foreign key (project_id, user_id)
    references public.research_projects (id, user_id) on delete cascade
);

create index paper_project_links_project_idx
  on public.paper_project_links (project_id, created_at desc);
create index paper_project_links_user_idx
  on public.paper_project_links (user_id);

alter table public.paper_project_links enable row level security;

create policy "Users read own paper links" on public.paper_project_links
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users create own paper links" on public.paper_project_links
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Users delete own paper links" on public.paper_project_links
  for delete to authenticated using (user_id = (select auth.uid()));
-- No update policy: links are immutable; remove and re-add instead.

-- Preserve existing data, then retire papers.project_id ------------------------
insert into public.paper_project_links (paper_id, project_id, user_id, created_at)
select id, project_id, user_id, created_at
from public.papers
where project_id is not null
on conflict do nothing;

drop trigger if exists papers_check_project_owner on public.papers;
drop function if exists public.check_paper_project_owner();
alter table public.papers drop column project_id;  -- also drops papers_project_idx

-- Duplicate detection: SHA-256 hex, unique per user -----------------------------
alter table public.papers
  add column content_hash text
    check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

-- Race-proof: two concurrent identical uploads cannot both insert.
-- Papers uploaded before this migration have NULL hash and are exempt.
create unique index papers_user_content_hash_key
  on public.papers (user_id, content_hash) where content_hash is not null;

commit;
