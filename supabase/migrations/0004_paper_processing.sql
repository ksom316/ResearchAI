-- ResearchAI Phase 3A: processing lifecycle + derived sections/chunks.
-- Additive to 0001-0003 (untouched). Run once in the Supabase SQL editor.
-- No embeddings / pgvector yet.
begin;

-- Processing lifecycle on papers -------------------------------------------------
-- papers.status already exists ('uploaded' | 'processing' | 'ready' | 'failed').
alter table public.papers
  add column processing_started_at timestamptz,
  add column processing_completed_at timestamptz,
  add column processing_error text
    check (processing_error is null or char_length(processing_error) <= 1000),
  add column page_count int check (page_count is null or page_count > 0);

alter table public.papers
  add constraint papers_processing_consistency_check check (
    -- an error message only makes sense for failed papers
    (status = 'failed' or processing_error is null)
    -- a ready paper must record when it finished and how many pages it has
    and (status <> 'ready' or (processing_completed_at is not null and page_count is not null))
  );

-- Lets a worker cheaply find pending / stuck work.
create index papers_pending_processing_idx
  on public.papers (created_at)
  where status in ('uploaded', 'processing');

-- Status is not a client-controlled trust signal ---------------------------------
-- The 0001 policy ("Users manage own papers", FOR ALL) let any signed-in client
-- write ANY column, including status. Row ownership stays enforced by RLS; column
-- privileges now limit what clients may write. Processing fields and status can
-- only be written by the service role (a future server-side worker).
revoke insert, update on public.papers from anon, authenticated;

grant insert (
  id, user_id, title, authors, publication_year,
  original_filename, mime_type, storage_path, content_hash, file_size_bytes
) on public.papers to authenticated;

grant update (title, authors, publication_year) on public.papers to authenticated;
-- New rows therefore always start as status = 'uploaded' (column default).

-- Sections -----------------------------------------------------------------------
create table public.paper_sections (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  position int not null check (position >= 0),
  title text not null check (char_length(trim(title)) between 1 and 300),
  section_type text not null default 'other' check (section_type in (
    'abstract', 'introduction', 'background', 'related_work', 'methods',
    'results', 'discussion', 'conclusion', 'limitations', 'references',
    'acknowledgments', 'appendix', 'other'
  )),
  page_start int check (page_start is null or page_start >= 1),
  page_end int check (page_end is null or page_end >= 1),
  text text not null default '',
  created_at timestamptz not null default now(),
  check (page_start is null or page_end is null or page_start <= page_end),
  unique (paper_id, position),
  unique (id, paper_id),  -- lets chunks prove their section belongs to the same paper
  -- The paper must belong to user_id, so rows can never cross accounts.
  foreign key (paper_id, user_id)
    references public.papers (id, user_id) on delete cascade
);

create index paper_sections_user_idx on public.paper_sections (user_id);

-- Chunks -------------------------------------------------------------------------
create table public.paper_chunks (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  section_id uuid not null,
  chunk_index int not null check (chunk_index >= 0),  -- order within the paper
  text text not null check (char_length(text) > 0),
  -- Offsets (in characters) of this chunk within its section's text.
  char_start int not null check (char_start >= 0),
  char_end int not null,
  char_count int generated always as (char_length(text)) stored,
  page_start int check (page_start is null or page_start >= 1),
  page_end int check (page_end is null or page_end >= 1),
  created_at timestamptz not null default now(),
  check (char_end > char_start),
  check (page_start is null or page_end is null or page_start <= page_end),
  unique (paper_id, chunk_index),
  foreign key (paper_id, user_id)
    references public.papers (id, user_id) on delete cascade,
  -- The section must belong to the same paper.
  foreign key (section_id, paper_id)
    references public.paper_sections (id, paper_id) on delete cascade
);

create index paper_chunks_section_idx on public.paper_chunks (section_id);
create index paper_chunks_user_idx on public.paper_chunks (user_id);

-- RLS: clients may only READ their own derived data --------------------------------
alter table public.paper_sections enable row level security;
alter table public.paper_chunks enable row level security;

create policy "Users read own paper sections" on public.paper_sections
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users read own paper chunks" on public.paper_chunks
  for select to authenticated using (user_id = (select auth.uid()));
-- No insert/update/delete policies, and privileges are revoked as defense in depth:
-- derived rows are written only by the service role (server-side worker).

revoke all on public.paper_sections, public.paper_chunks from anon, authenticated;
grant select on public.paper_sections, public.paper_chunks to authenticated;
grant select, insert, update, delete
  on public.paper_sections, public.paper_chunks to service_role;

commit;
