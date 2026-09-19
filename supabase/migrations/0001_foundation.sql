-- ResearchAI Phase 1 foundation schema.
-- Run in the Supabase SQL editor (or `supabase db push`).

-- Shared trigger: keep updated_at fresh.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Profiles -------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Research projects ----------------------------------------------------------
create table public.research_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index research_projects_user_updated_idx
  on public.research_projects (user_id, updated_at desc);

create trigger research_projects_updated_at before update on public.research_projects
  for each row execute function public.set_updated_at();

-- Papers (metadata only in Phase 1; no processing yet) -----------------------
create table public.papers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid references public.research_projects (id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 500),
  authors text[] not null default '{}',
  publication_year int check (publication_year between 1000 and 3000),
  storage_path text,               -- object path in the papers bucket
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index papers_user_created_idx on public.papers (user_id, created_at desc);
create index papers_project_idx on public.papers (project_id);

create trigger papers_updated_at before update on public.papers
  for each row execute function public.set_updated_at();

-- A paper may only be attached to a project owned by the same user.
create or replace function public.check_paper_project_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.research_projects p
    where p.id = new.project_id and p.user_id = new.user_id
  ) then
    raise exception 'Project does not belong to the paper owner';
  end if;
  return new;
end;
$$;

create trigger papers_check_project_owner
  before insert or update of project_id, user_id on public.papers
  for each row execute function public.check_paper_project_owner();

-- Row Level Security ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.research_projects enable row level security;
alter table public.papers enable row level security;

create policy "Users read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "Users update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Users manage own projects" on public.research_projects
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Users manage own papers" on public.papers
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Storage: private bucket for future PDF uploads ------------------------------
-- Objects must live under a top-level folder named after the user id
-- (user_id/file.pdf) so the policies below can scope access by owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('papers', 'papers', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy "Users read own paper files" on storage.objects
  for select to authenticated
  using (bucket_id = 'papers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users upload own paper files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'papers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users update own paper files" on storage.objects
  for update to authenticated
  using (bucket_id = 'papers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete own paper files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'papers' and (storage.foldername(name))[1] = (select auth.uid())::text);
