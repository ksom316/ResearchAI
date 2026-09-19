-- ResearchAI Phase 4A: pgvector foundation for semantic retrieval.
-- Additive to 0001-0005 (untouched). Run once in the Supabase SQL editor.
--
-- Creates ONLY database structure. It does not call any embedding API, does not
-- create indexing jobs, and does not touch the PDF processing lifecycle
-- (papers.status and friends are unchanged). Nothing becomes "searchable" until
-- the Phase 4C worker embeds chunks and marks a job complete.
--
-- Design notes
--  * Vectors live in a SEPARATE table (chunk_embeddings), never on paper_chunks,
--    and no browser role can read or write it.
--  * Every vector carries the model/profile it was produced with, so vectors from
--    different models are never compared or mixed.
--  * Exact (sequential) cosine search only: no HNSW / IVFFlat index yet.
--  * Indexing state is its own lifecycle (paper_embedding_jobs), independent of
--    papers.status.
begin;

-- Supabase installs extensions in the "extensions" schema, which is on the default
-- search_path; make it explicit so `vector` resolves either way.
set local search_path = public, extensions;

create extension if not exists vector with schema extensions;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'vector') then
    raise exception 'pgvector (extension "vector") is not available on this project';
  end if;
end;
$$;

-- Embedding model / profile registry --------------------------------------------
-- One row per (provider, model, dimension, input profile). The "input profile" is
-- the version of the recipe that builds the embedded text (e.g. title + section +
-- chunk). Changing the recipe changes the vector space, so it is a new profile.
create table public.embedding_models (
  id text primary key
    check (id ~ '^[a-z0-9][a-z0-9._:-]{2,99}$'),
  provider text not null
    check (provider ~ '^[a-z0-9][a-z0-9_-]{0,49}$'),
  provider_model text not null
    check (char_length(provider_model) between 1 and 100),
  -- Must match vector(1024) in chunk_embeddings; a different size needs a new column.
  dimensions int not null check (dimensions = 1024),
  input_profile text not null
    check (input_profile ~ '^[a-z0-9][a-z0-9._-]{0,49}$'),
  distance text not null default 'cosine' check (distance = 'cosine'),
  status text not null default 'building'
    check (status in ('building', 'active', 'retired')),
  -- Calibrated per model in a later phase; scores are not comparable across models.
  min_similarity real check (min_similarity is null or min_similarity between -1 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz,
  unique (provider, provider_model, dimensions, input_profile)
);

-- At most ONE active profile, so searches always have a single vector space.
-- (To switch: retire the current one first, then activate the new one, in one
-- transaction. 'building' profiles can be backfilled alongside without being searched.)
create unique index embedding_models_single_active_idx
  on public.embedding_models ((true)) where status = 'active';

create trigger embedding_models_updated_at before update on public.embedding_models
  for each row execute function public.set_updated_at();

-- What a vector means is fixed once vectors exist: identity columns are immutable.
create or replace function public.embedding_models_protect_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id
     or new.provider is distinct from old.provider
     or new.provider_model is distinct from old.provider_model
     or new.dimensions is distinct from old.dimensions
     or new.input_profile is distinct from old.input_profile
     or new.distance is distinct from old.distance then
    raise exception 'embedding model identity columns are immutable; create a new profile instead';
  end if;
  return new;
end;
$$;

create trigger embedding_models_protect_identity before update on public.embedding_models
  for each row execute function public.embedding_models_protect_identity();

-- Phase 4 profile: Voyage AI voyage-4, 1024 dimensions. No credentials are stored here.
insert into public.embedding_models
  (id, provider, provider_model, dimensions, input_profile, status, activated_at)
values
  ('voyage-4:1024:ctx-v1', 'voyage', 'voyage-4', 1024, 'ctx-v1', 'active', now())
on conflict (id) do nothing;

-- Chunk embeddings ----------------------------------------------------------------
-- The composite FK below needs (id, paper_id, user_id) to be unique on paper_chunks.
-- id is already the primary key, so this cannot fail on existing data.
alter table public.paper_chunks
  add constraint paper_chunks_id_paper_user_key unique (id, paper_id, user_id);

create table public.chunk_embeddings (
  chunk_id uuid not null,
  model_id text not null references public.embedding_models (id) on delete restrict,
  -- Denormalized ownership, enforced by the composite FK: a vector can never be
  -- attached to a chunk of a different paper or user.
  paper_id uuid not null,
  user_id uuid not null,
  embedding vector(1024) not null,
  -- sha256 (hex) of the exact text that was embedded; lets a worker detect drift.
  content_hash text check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (chunk_id, model_id),
  -- Deleting or reprocessing chunks (complete_paper_processing recreates them)
  -- removes their vectors, so stale embeddings can never outlive their text.
  foreign key (chunk_id, paper_id, user_id)
    references public.paper_chunks (id, paper_id, user_id) on delete cascade
);

-- Ordinary relational indexes only. Deliberately NO approximate vector index
-- (HNSW / IVFFlat): every search is filtered to one user, so exact scans are
-- fast enough and have perfect recall. Revisit when data size justifies it.
create index chunk_embeddings_paper_model_idx
  on public.chunk_embeddings (paper_id, model_id);
create index chunk_embeddings_user_model_idx
  on public.chunk_embeddings (user_id, model_id);
create index chunk_embeddings_model_idx
  on public.chunk_embeddings (model_id);

-- Indexing jobs ---------------------------------------------------------------------
-- One logical job per (paper, model profile), with its own lifecycle that is
-- independent of papers.status. A failed embedding never makes a parsed paper
-- "failed". No rows are created here: the Phase 4C worker creates them lazily, which
-- also backfills papers that are already ready.
--
-- Searchability rule (enforced by the later retrieval function, documented here):
--   papers.status = 'ready'
--   AND job.status = 'complete'
--   AND job.source_completed_at = papers.processing_completed_at
-- The last condition is what invalidates a job when a paper is reprocessed: new
-- processing sets a new processing_completed_at and (via cascade) deletes the old
-- vectors, so a stale 'complete' job is never treated as current.
create table public.paper_embedding_jobs (
  paper_id uuid not null,
  model_id text not null references public.embedding_models (id) on delete restrict,
  user_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'embedding', 'complete', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  -- papers.processing_completed_at of the chunk generation this job covers.
  source_completed_at timestamptz not null,
  -- Fencing token: set when a worker claims the job, cleared when it ends. Writes
  -- by a worker whose token no longer matches are refused (same pattern as papers).
  claim_started_at timestamptz,
  completed_at timestamptz,
  chunk_count int check (chunk_count is null or chunk_count >= 0),
  embedded_count int not null default 0 check (embedded_count >= 0),
  -- Safe, fixed-vocabulary message only (never raw provider errors).
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (paper_id, model_id),
  foreign key (paper_id, user_id)
    references public.papers (id, user_id) on delete cascade,
  constraint paper_embedding_jobs_consistency_check check (
    -- a claim exists exactly while a worker is embedding
    (status = 'embedding') = (claim_started_at is not null)
    -- an error message goes with 'failed', and every failure has one
    and (status = 'failed') = (last_error is not null)
    -- complete means every chunk has been embedded
    and (status <> 'complete'
         or (completed_at is not null and chunk_count is not null
             and embedded_count = chunk_count))
    and (chunk_count is null or embedded_count <= chunk_count)
  )
);

create index paper_embedding_jobs_model_status_idx
  on public.paper_embedding_jobs (model_id, status);
create index paper_embedding_jobs_user_idx
  on public.paper_embedding_jobs (user_id);

create trigger paper_embedding_jobs_updated_at before update on public.paper_embedding_jobs
  for each row execute function public.set_updated_at();

-- Row Level Security ---------------------------------------------------------------
alter table public.embedding_models enable row level security;
alter table public.chunk_embeddings enable row level security;
alter table public.paper_embedding_jobs enable row level security;

-- Start from nothing for browser roles on all three tables.
revoke all on public.embedding_models, public.chunk_embeddings, public.paper_embedding_jobs
  from anon, authenticated;

-- chunk_embeddings: NO browser policy and NO browser grant. Raw vectors are
-- unreachable from the browser; the only read path will be a security-definer
-- retrieval function (Phase 4D) that never returns vectors.

-- embedding_models: non-secret metadata (provider name, model name, status).
-- Read-only for signed-in users so servers can pick the active profile.
create policy "Signed-in users read embedding models" on public.embedding_models
  for select to authenticated using (true);
grant select on public.embedding_models to authenticated;

-- paper_embedding_jobs: owners may read a minimal, safe subset of their own jobs so
-- the UI can show indexing status. Column privileges hide attempts, claim_started_at,
-- last_error and user_id from browsers. All writes are service-role only.
create policy "Users read own embedding job status" on public.paper_embedding_jobs
  for select to authenticated using (user_id = (select auth.uid()));
grant select (
  paper_id, model_id, status, chunk_count, embedded_count,
  source_completed_at, completed_at, created_at, updated_at
) on public.paper_embedding_jobs to authenticated;

-- The worker (service role) manages all three tables directly.
grant select, insert, update, delete
  on public.embedding_models, public.chunk_embeddings, public.paper_embedding_jobs
  to service_role;

commit;
