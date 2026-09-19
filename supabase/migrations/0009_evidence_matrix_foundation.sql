-- ResearchAI Phase 6A.1: Evidence Matrix database foundation.
-- Additive to 0001-0008 (untouched). Run once in the Supabase SQL editor.
-- Requires PostgreSQL 15+ (ON DELETE SET NULL (column) and security_invoker views);
-- Supabase projects are on 15+.
--
-- WHAT THIS ADDS
--   paper_extractions          one row per (paper, schema_version): execution state
--   paper_extraction_fields    the seven fixed fields of that extraction (bounded JSON)
--   paper_extraction_sources   provenance snapshot for each extracted item
--   paper_extraction_overview  read view that DERIVES staleness
--   4 service_role-only functions (claim / store field / complete / fail)
--
-- OWNERSHIP: extraction belongs to the PAPER (never to a project). A project's matrix
-- is a later join of paper_project_links with these tables, so nothing is duplicated
-- per project. All child rows carry user_id and composite foreign keys, so a row can
-- never point at another user's paper, chunk or section.
--
-- GENERATION / STALENESS (authoritative rule):
--     stale  <=>  paper_extractions.source_completed_at IS DISTINCT FROM
--                 papers.processing_completed_at
-- Reprocessing (0005) sets a new processing_completed_at, so an old extraction becomes
-- observably stale immediately, with no trigger and no change to that pipeline. It is
-- derived only: there is no stored 'stale' status. Stale data is NOT deleted
-- automatically (a user may still see "out of date"); the next claim for the new
-- generation discards it and resets the row to 'pending' in one transaction, so even a
-- 'complete' extraction of an old generation is claimable again.
--
-- PROVENANCE SURVIVES REPROCESSING: reprocessing deletes paper_sections and
-- paper_chunks. The source rows reference them with ON DELETE SET NULL (chunk_id) /
-- (section_id), so the row is KEPT with its snapshot (section title/type, pages,
-- excerpt) and only the live pointer is cleared. The paper title is not copied: it is
-- read from papers.
--
-- BROWSER ACCESS: read-only, owner-only, column-restricted (no user_id, claim, attempt
-- or error columns). Every write goes through the service-role functions below, which
-- derive citation metadata from the database (never from the caller) and are fenced
-- with a claim token, exactly like the 0005/0007 worker functions.
begin;

-- Extraction state ------------------------------------------------------------------
create table public.paper_extractions (
  paper_id uuid not null,
  schema_version int not null check (schema_version between 1 and 1000),
  user_id uuid not null,
  -- The papers.processing_completed_at this extraction was built from.
  source_completed_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'complete', 'partial', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  -- Fence token of the current run (future worker or server execution).
  claim_started_at timestamptz,
  provider text check (provider is null or char_length(provider) between 1 and 100),
  model text check (model is null or char_length(model) between 1 and 200),
  completed_at timestamptz,
  -- Internal, never readable by browsers.
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One extraction per paper and schema version: no duplicate "current" records.
  primary key (paper_id, schema_version),
  -- Target for the child tables' ownership foreign keys.
  unique (paper_id, schema_version, user_id),
  foreign key (paper_id, user_id)
    references public.papers (id, user_id) on delete cascade,
  constraint paper_extractions_consistency_check check (
    (status = 'running') = (claim_started_at is not null)
    and (status = 'failed') = (last_error is not null)
    and (status not in ('complete', 'partial') or completed_at is not null)
    and (provider is null) = (model is null)
  )
);

-- The user_id index serves the owner-only policy; the partial index lets a future
-- worker find open work without scanning finished rows.
create index paper_extractions_user_idx on public.paper_extractions (user_id);
create index paper_extractions_open_idx
  on public.paper_extractions (schema_version, updated_at)
  where status in ('pending', 'running');

create trigger paper_extractions_updated_at before update on public.paper_extractions
  for each row execute function public.set_updated_at();

-- Fields ---------------------------------------------------------------------------
create table public.paper_extraction_fields (
  paper_id uuid not null,
  schema_version int not null,
  field_key text not null check (field_key in (
    'objective', 'methodology', 'dataset', 'findings',
    'limitations', 'future_work', 'concepts'
  )),
  user_id uuid not null,
  state text not null check (state in ('extracted', 'not_reported', 'failed')),
  -- {"items": [...]}: exact item shape is validated by the application (zod). The
  -- database enforces only what it can safely: an object, a size cap, and that
  -- "extracted" has 1..12 items while not_reported / failed have none.
  value jsonb not null default '{"items": []}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (paper_id, schema_version, field_key),
  unique (paper_id, schema_version, field_key, user_id),
  foreign key (paper_id, schema_version, user_id)
    references public.paper_extractions (paper_id, schema_version, user_id)
    on delete cascade,
  constraint paper_extraction_fields_value_check check (
    jsonb_typeof(value) = 'object'
    and octet_length(value::text) <= 20000
    -- coalesce(.., -1): a NULL would let a CHECK pass, so a non-array "items" must fail.
    and case
      when state = 'extracted' then
        coalesce(case when jsonb_typeof(value -> 'items') = 'array'
                      then jsonb_array_length(value -> 'items') end, -1) between 1 and 12
      else
        (value -> 'items') is null
        or coalesce(case when jsonb_typeof(value -> 'items') = 'array'
                         then jsonb_array_length(value -> 'items') end, -1) = 0
    end
  )
);

create trigger paper_extraction_fields_updated_at before update on public.paper_extraction_fields
  for each row execute function public.set_updated_at();

-- Sources (provenance) -----------------------------------------------------------
create table public.paper_extraction_sources (
  paper_id uuid not null,
  schema_version int not null,
  field_key text not null,
  user_id uuid not null,
  -- Which item of the field's "items" array this source supports, and its order.
  item_index int not null check (item_index between 0 and 11),
  ord int not null default 0 check (ord between 0 and 9),
  -- Live pointers: cleared (not deleted) when reprocessing removes the chunk/section.
  chunk_id uuid,
  section_id uuid,
  -- Snapshot, filled by the database from the chunk/section at write time.
  section_title text not null check (char_length(section_title) between 1 and 300),
  section_type text not null check (section_type in (
    'abstract', 'introduction', 'background', 'related_work', 'methods',
    'results', 'discussion', 'conclusion', 'limitations', 'references',
    'acknowledgments', 'appendix', 'other'
  )),
  page_start int check (page_start is null or page_start >= 1),
  page_end int check (page_end is null or page_end >= 1),
  -- A verbatim excerpt of the cited chunk (verified at write time), bounded.
  excerpt text check (excerpt is null or char_length(excerpt) between 1 and 400),
  created_at timestamptz not null default now(),
  primary key (paper_id, schema_version, field_key, item_index, ord),
  check (page_start is null or page_end is null or page_start <= page_end),
  foreign key (paper_id, schema_version, field_key, user_id)
    references public.paper_extraction_fields (paper_id, schema_version, field_key, user_id)
    on delete cascade,
  -- Same paper AND same owner, but the row outlives the chunk / section.
  foreign key (chunk_id, paper_id, user_id)
    references public.paper_chunks (id, paper_id, user_id) on delete set null (chunk_id),
  foreign key (section_id, paper_id)
    references public.paper_sections (id, paper_id) on delete set null (section_id)
);

-- Postgres must find the referencing rows when a chunk / section is deleted
-- (reprocessing); without these every such delete would scan this table.
create index paper_extraction_sources_chunk_idx on public.paper_extraction_sources (chunk_id);
create index paper_extraction_sources_section_idx on public.paper_extraction_sources (section_id);

-- Derived staleness --------------------------------------------------------------
-- security_invoker: the caller's RLS and column grants apply to the underlying tables,
-- so a user only ever sees their own rows and none of the hidden columns.
create view public.paper_extraction_overview
with (security_invoker = true) as
select e.paper_id,
       e.schema_version,
       e.status,
       e.source_completed_at,
       e.completed_at,
       e.provider,
       e.model,
       e.created_at,
       e.updated_at,
       (e.source_completed_at is distinct from p.processing_completed_at) as is_stale
  from public.paper_extractions e
  join public.papers p on p.id = e.paper_id;

-- RLS and privileges --------------------------------------------------------------
alter table public.paper_extractions enable row level security;
alter table public.paper_extraction_fields enable row level security;
alter table public.paper_extraction_sources enable row level security;

revoke all on public.paper_extractions, public.paper_extraction_fields,
              public.paper_extraction_sources, public.paper_extraction_overview
  from anon, authenticated;

create policy "Users read own extractions" on public.paper_extractions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users read own extraction fields" on public.paper_extraction_fields
  for select to authenticated using (user_id = (select auth.uid()));
create policy "Users read own extraction sources" on public.paper_extraction_sources
  for select to authenticated using (user_id = (select auth.uid()));
-- No insert/update/delete policies or privileges for browsers, by design.

-- Column grants hide user_id, attempts, claim_started_at and last_error.
grant select (
  paper_id, schema_version, source_completed_at, status, provider, model,
  completed_at, created_at, updated_at
) on public.paper_extractions to authenticated;
grant select (
  paper_id, schema_version, field_key, state, value, created_at, updated_at
) on public.paper_extraction_fields to authenticated;
grant select (
  paper_id, schema_version, field_key, item_index, ord, chunk_id, section_id,
  section_title, section_type, page_start, page_end, excerpt
) on public.paper_extraction_sources to authenticated;
grant select on public.paper_extraction_overview to authenticated;

grant select, insert, update, delete
  on public.paper_extractions, public.paper_extraction_fields, public.paper_extraction_sources
  to service_role;
grant select on public.paper_extraction_overview to service_role;

-- Fenced write path (service_role only; same pattern as 0005 / 0007) ------------------

-- Starts (or resumes) an extraction for one ready paper and returns a claim. A paper
-- whose extraction is already complete for the CURRENT generation is not claimable,
-- so an unchanged paper is never re-extracted. A new generation discards the old
-- generation's fields and sources before the new claim.
create or replace function public.claim_paper_extraction(
  p_paper_id uuid,
  p_schema_version int,
  p_stale_after interval default interval '15 minutes'
)
returns table (
  paper_id uuid,
  user_id uuid,
  schema_version int,
  source_completed_at timestamptz,
  claim_started_at timestamptz,
  attempts int
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid;
  v_generation timestamptz;
  v_current timestamptz;
begin
  if p_schema_version is null or p_schema_version not between 1 and 1000 then
    raise exception 'invalid schema version';
  end if;

  select p.user_id, p.processing_completed_at
    into v_user, v_generation
    from public.papers p
   where p.id = p_paper_id
     and p.status = 'ready'
     and p.processing_completed_at is not null;
  if not found then
    return;
  end if;

  insert into public.paper_extractions (paper_id, schema_version, user_id, source_completed_at)
  values (p_paper_id, p_schema_version, v_user, v_generation)
  on conflict (paper_id, schema_version) do nothing;

  select e.source_completed_at
    into v_current
    from public.paper_extractions e
   where e.paper_id = p_paper_id and e.schema_version = p_schema_version
     for update;

  if v_current is distinct from v_generation then
    -- The paper was reprocessed: drop the old generation (sources cascade) and reset.
    delete from public.paper_extraction_fields f
     where f.paper_id = p_paper_id and f.schema_version = p_schema_version;
    update public.paper_extractions e
       set status = 'pending',
           source_completed_at = v_generation,
           attempts = 0,
           claim_started_at = null,
           provider = null,
           model = null,
           completed_at = null,
           last_error = null
     where e.paper_id = p_paper_id and e.schema_version = p_schema_version;
  end if;

  return query
  with claimed as (
    update public.paper_extractions e
       set status = 'running',
           claim_started_at = clock_timestamp(),
           attempts = e.attempts + 1,
           completed_at = null,
           last_error = null
     where e.paper_id = p_paper_id
       and e.schema_version = p_schema_version
       and (
         e.status in ('pending', 'failed', 'partial')
         or (e.status = 'running' and e.updated_at < now() - p_stale_after)
       )
    returning e.paper_id, e.user_id, e.schema_version, e.source_completed_at,
              e.claim_started_at, e.attempts
  )
  select c.paper_id, c.user_id, c.schema_version, c.source_completed_at,
         c.claim_started_at, c.attempts
    from claimed c;
end;
$$;

-- Replaces ONE field (and its sources) for the claimed run. Citation metadata is read
-- from the database: each source names only a chunk, an item and an optional excerpt,
-- and the section title/type and pages are copied from that chunk's own rows. The
-- excerpt must occur verbatim in the chunk. Returns false when the claim no longer
-- holds (fenced out, paper reprocessed, or not running).
create or replace function public.store_extraction_field(
  p_paper_id uuid,
  p_schema_version int,
  p_claim_started_at timestamptz,
  p_field_key text,
  p_state text,
  p_value jsonb,
  p_sources jsonb default '[]'::jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_items int;
  v_n int;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'p_value must be a JSON object';
  end if;
  if p_sources is null
     or jsonb_typeof(p_sources) <> 'array'
     or jsonb_array_length(p_sources) > 60 then
    raise exception 'p_sources must be a JSON array of at most 60 sources';
  end if;

  select e.user_id
    into v_user
    from public.paper_extractions e
    join public.papers p on p.id = e.paper_id
   where e.paper_id = p_paper_id
     and e.schema_version = p_schema_version
     and e.status = 'running'
     and e.claim_started_at = p_claim_started_at
     and p.status = 'ready'
     and e.source_completed_at = p.processing_completed_at
     for update of e;
  if not found then
    return false;
  end if;

  v_items := case when jsonb_typeof(p_value -> 'items') = 'array'
                  then jsonb_array_length(p_value -> 'items') else 0 end;
  if p_state <> 'extracted' and jsonb_array_length(p_sources) > 0 then
    raise exception 'only extracted fields can carry sources';
  end if;

  -- Field key / state / value shape are validated by the table constraints.
  delete from public.paper_extraction_fields f
   where f.paper_id = p_paper_id
     and f.schema_version = p_schema_version
     and f.field_key = p_field_key;
  insert into public.paper_extraction_fields
    (paper_id, schema_version, field_key, user_id, state, value)
  values (p_paper_id, p_schema_version, p_field_key, v_user, p_state, p_value);

  insert into public.paper_extraction_sources
    (paper_id, schema_version, field_key, user_id, item_index, ord, chunk_id, section_id,
     section_title, section_type, page_start, page_end, excerpt)
  select p_paper_id, p_schema_version, p_field_key, v_user,
         x.item_index, coalesce(x.ord, 0), c.id, s.id,
         s.title, s.section_type, c.page_start, c.page_end, x.excerpt
    from jsonb_to_recordset(p_sources) as x(item_index int, ord int, chunk_id uuid, excerpt text)
    join public.paper_chunks c
      on c.id = x.chunk_id and c.paper_id = p_paper_id and c.user_id = v_user
    join public.paper_sections s
      on s.id = c.section_id and s.paper_id = c.paper_id
   where x.item_index >= 0
     and x.item_index < v_items
     and (
       x.excerpt is null
       or (char_length(x.excerpt) between 1 and 400
           and position(x.excerpt in c.text) > 0)
     );
  get diagnostics v_n = row_count;
  if v_n <> jsonb_array_length(p_sources) then
    raise exception 'every source needs a chunk of this paper, a valid item and a verbatim excerpt';
  end if;

  -- Progress counts as activity, so a long run is not mistaken for an abandoned one.
  update public.paper_extractions e
     set updated_at = now()
   where e.paper_id = p_paper_id and e.schema_version = p_schema_version;

  return true;
end;
$$;

-- Ends the claimed run. The status is computed here, not chosen by the caller:
-- 'complete' only when all seven fields exist and none failed, otherwise 'partial'.
-- Returns the final status, or null when the claim no longer holds.
create or replace function public.complete_paper_extraction(
  p_paper_id uuid,
  p_schema_version int,
  p_claim_started_at timestamptz,
  p_provider text,
  p_model text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_fields int;
  v_failed int;
  v_status text;
begin
  if nullif(trim(p_provider), '') is null or nullif(trim(p_model), '') is null then
    raise exception 'provider and model are required';
  end if;

  perform 1
     from public.paper_extractions e
     join public.papers p on p.id = e.paper_id
    where e.paper_id = p_paper_id
      and e.schema_version = p_schema_version
      and e.status = 'running'
      and e.claim_started_at = p_claim_started_at
      and p.status = 'ready'
      and e.source_completed_at = p.processing_completed_at
      for update of e;
  if not found then
    return null;
  end if;

  select count(*)::int, count(*) filter (where f.state = 'failed')::int
    into v_fields, v_failed
    from public.paper_extraction_fields f
   where f.paper_id = p_paper_id and f.schema_version = p_schema_version;
  if v_fields = 0 then
    raise exception 'cannot complete an extraction with no stored fields';
  end if;

  v_status := case when v_fields = 7 and v_failed = 0 then 'complete' else 'partial' end;

  update public.paper_extractions e
     set status = v_status,
         claim_started_at = null,
         completed_at = now(),
         provider = nullif(left(trim(p_provider), 100), ''),
         model = nullif(left(trim(p_model), 200), ''),
         last_error = null
   where e.paper_id = p_paper_id and e.schema_version = p_schema_version;

  return v_status;
end;
$$;

-- Ends the claimed run as failed with a short internal error (never shown to browsers).
-- Fields already stored are kept; the next claim may resume.
create or replace function public.fail_paper_extraction(
  p_paper_id uuid,
  p_schema_version int,
  p_claim_started_at timestamptz,
  p_error text
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform 1
     from public.paper_extractions e
    where e.paper_id = p_paper_id
      and e.schema_version = p_schema_version
      and e.status = 'running'
      and e.claim_started_at = p_claim_started_at
      for update;
  if not found then
    return false;
  end if;

  update public.paper_extractions e
     set status = 'failed',
         claim_started_at = null,
         completed_at = null,
         last_error = coalesce(left(nullif(trim(p_error), ''), 500), 'Extraction failed.')
   where e.paper_id = p_paper_id and e.schema_version = p_schema_version;

  return true;
end;
$$;

revoke all on function public.claim_paper_extraction(uuid, int, interval)
  from public, anon, authenticated;
revoke all on function public.store_extraction_field(uuid, int, timestamptz, text, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_paper_extraction(uuid, int, timestamptz, text, text)
  from public, anon, authenticated;
revoke all on function public.fail_paper_extraction(uuid, int, timestamptz, text)
  from public, anon, authenticated;

grant execute on function public.claim_paper_extraction(uuid, int, interval) to service_role;
grant execute on function public.store_extraction_field(uuid, int, timestamptz, text, text, jsonb, jsonb) to service_role;
grant execute on function public.complete_paper_extraction(uuid, int, timestamptz, text, text) to service_role;
grant execute on function public.fail_paper_extraction(uuid, int, timestamptz, text) to service_role;

commit;
