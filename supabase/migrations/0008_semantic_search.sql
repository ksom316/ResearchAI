-- ResearchAI Phase 4D.1: secure semantic-search boundary (read-only SQL functions).
-- Additive to 0001-0007 (untouched). Run once in the Supabase SQL editor.
--
-- Three functions, all in `public`:
--   search_scope_paper_ids  PRIVATE helper: resolves + validates a search scope
--   get_search_coverage     RPC: which papers in a scope are searchable, and why not
--   search_paper_chunks     RPC: exact cosine top-k over the caller's current embeddings
--
-- WHY SECURITY DEFINER: raw vectors are deliberately unreadable by browsers
-- (chunk_embeddings has no browser grant or policy), so an INVOKER function could not
-- read them. These functions therefore run with the owner's privileges, which
-- bypasses RLS. Every table access below is instead scoped explicitly by
-- auth.uid() (taken from the caller's JWT; there is NO user id parameter anywhere),
-- with search_path pinned and every relation schema-qualified.
--
-- What they never do: write anything (all are STABLE and contain no DML), return
-- vectors, content hashes, user ids, storage paths or internal job fields, call any
-- provider, or use an approximate (ANN) index. No index is created here.
--
-- Errors are fixed identifiers (no ids, no row data):
--   search_unauthenticated | search_invalid_argument | search_invalid_embedding
--   search_scope_not_found | search_model_mismatch
begin;

-- Private helper ---------------------------------------------------------------------
-- Returns the ids of the CALLER'S papers in scope:
--   both null            -> every paper the caller owns (whole library)
--   p_project_id         -> papers linked to that project (via paper_project_links)
--   p_paper_ids          -> exactly those papers
--   both                 -> the intersection
-- Uniform failure: a project or paper id that does not exist and one that belongs to
-- someone else raise the SAME error, and a list with any such id yields no partial
-- result, so a caller can never tell which ids exist. Callable only from the other
-- two functions; revoked from every API role below.
create or replace function public.search_scope_paper_ids(
  p_paper_ids uuid[] default null,
  p_project_id uuid default null
)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
begin
  if v_uid is null then
    raise exception 'search_unauthenticated' using errcode = '28000';
  end if;

  if p_paper_ids is not null then
    if exists (select 1 from unnest(p_paper_ids) as x where x is null) then
      raise exception 'search_invalid_argument' using errcode = '22023';
    end if;
    select coalesce(array_agg(distinct x), '{}'::uuid[])
      into v_ids
      from unnest(p_paper_ids) as x;
    if cardinality(v_ids) < 1 or cardinality(v_ids) > 50 then
      raise exception 'search_invalid_argument' using errcode = '22023';
    end if;
    if (select count(*) from public.papers p
         where p.user_id = v_uid and p.id = any (v_ids)) <> cardinality(v_ids) then
      raise exception 'search_scope_not_found' using errcode = 'P0002';
    end if;
  end if;

  if p_project_id is not null
     and not exists (
       select 1 from public.research_projects rp
        where rp.id = p_project_id and rp.user_id = v_uid
     ) then
    raise exception 'search_scope_not_found' using errcode = 'P0002';
  end if;

  return query
  select p.id
    from public.papers p
   where p.user_id = v_uid
     and (v_ids is null or p.id = any (v_ids))
     and (
       p_project_id is null
       or exists (
         select 1 from public.paper_project_links l
          where l.paper_id = p.id
            and l.project_id = p_project_id
            and l.user_id = v_uid
       )
     );
end;
$$;

-- Coverage ------------------------------------------------------------------------------
-- One row per owned paper in scope with its search state for the ACTIVE profile:
--   searchable      ready, job complete, generation current
--   pdf_processing  PDF not processed yet (uploaded / processing)
--   pdf_failed      PDF processing failed
--   not_indexed     ready but no indexing job (yet) for the active profile
--   index_pending   job waiting to run
--   indexing        job running
--   index_failed    job failed
--   index_stale     job belongs to an OLDER generation (paper was reprocessed)
-- Missing/foreign scope ids raise the uniform search_scope_not_found error.
create or replace function public.get_search_coverage(
  p_paper_ids uuid[] default null,
  p_project_id uuid default null
)
returns table (
  paper_id uuid,
  paper_title text,
  state text,
  chunk_count int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_model text;
begin
  if v_uid is null then
    raise exception 'search_unauthenticated' using errcode = '28000';
  end if;

  select m.id into v_model
    from public.embedding_models m
   where m.status = 'active';

  return query
  select p.id,
         p.title,
         case
           when p.status in ('uploaded', 'processing') then 'pdf_processing'
           when p.status = 'failed' then 'pdf_failed'
           when j.paper_id is null then 'not_indexed'
           when j.source_completed_at is distinct from p.processing_completed_at then 'index_stale'
           when j.status = 'complete' then 'searchable'
           when j.status = 'failed' then 'index_failed'
           when j.status = 'embedding' then 'indexing'
           else 'index_pending'
         end,
         (select count(*)::int
            from public.paper_chunks c
           where c.paper_id = p.id and c.user_id = v_uid)
    from public.papers p
    left join public.paper_embedding_jobs j
      on j.paper_id = p.id
     and j.model_id = v_model
     and j.user_id = v_uid
   where p.user_id = v_uid
     and p.id in (
       select sc from public.search_scope_paper_ids(p_paper_ids, p_project_id) as sc
     )
   order by p.title, p.id;
end;
$$;

-- Search ----------------------------------------------------------------------------------
-- Exact cosine top-k (pgvector `<=>` = cosine distance) over the caller's CURRENT
-- embeddings for the single ACTIVE profile.
--   p_query_embedding  JSON array of exactly 1024 finite numbers (cast to vector(1024)
--                      server-side; a parameterized value, never SQL text)
--   p_expected_model_id the profile the caller embedded the query with; must equal the
--                      active profile or search_model_mismatch is raised, so vectors
--                      from different spaces are never compared
--   p_limit            default 10, clamped to 1..50
--   p_min_similarity   optional, -1..1 (no calibrated default yet)
--   p_include_references  reference sections are excluded unless true
-- A vector is returned only when ALL of these hold: paper owned + ready, its job for
-- the active profile is complete AND source_completed_at = processing_completed_at
-- (current generation), and the chunk, embedding, section and job all belong to the
-- caller and to that same paper. Ranking is similarity DESC (distance ASC) with a
-- deterministic tie-break on paper_id, chunk_index.
create or replace function public.search_paper_chunks(
  p_query_embedding jsonb,
  p_expected_model_id text,
  p_paper_ids uuid[] default null,
  p_project_id uuid default null,
  p_limit int default 10,
  p_min_similarity double precision default null,
  p_include_references boolean default false
)
returns table (
  rank int,
  similarity double precision,
  paper_id uuid,
  paper_title text,
  chunk_id uuid,
  chunk_index int,
  char_start int,
  char_end int,
  page_start int,
  page_end int,
  section_id uuid,
  section_title text,
  section_type text,
  section_position int,
  content text
)
language plpgsql
stable
security definer
set search_path = extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_model text;
  v_query vector(1024);
  v_limit int;
begin
  if v_uid is null then
    raise exception 'search_unauthenticated' using errcode = '28000';
  end if;

  if p_expected_model_id is null
     or (p_min_similarity is not null
         and (p_min_similarity < -1 or p_min_similarity > 1)) then
    raise exception 'search_invalid_argument' using errcode = '22023';
  end if;

  if p_query_embedding is null
     or jsonb_typeof(p_query_embedding) <> 'array'
     or jsonb_array_length(p_query_embedding) <> 1024 then
    raise exception 'search_invalid_embedding' using errcode = '22023';
  end if;

  begin
    v_query := (p_query_embedding::text)::vector(1024);
  exception when others then
    -- non-numeric elements, out-of-range numbers, ...
    raise exception 'search_invalid_embedding' using errcode = '22023';
  end;
  if (v_query <#> v_query) = 0 then
    -- an all-zero vector has no direction: cosine similarity is undefined
    raise exception 'search_invalid_embedding' using errcode = '22023';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 10), 1), 50);

  select m.id into v_model
    from public.embedding_models m
   where m.status = 'active';
  if v_model is null or v_model <> p_expected_model_id then
    raise exception 'search_model_mismatch' using errcode = 'P0001';
  end if;

  return query
  with scope as (
    select sc as pid
      from public.search_scope_paper_ids(p_paper_ids, p_project_id) as sc
  ),
  top as (
    select p.id as pid,
           p.title as ptitle,
           c.id as cid,
           c.chunk_index as cidx,
           c.char_start as cstart,
           c.char_end as cend,
           c.page_start as pstart,
           c.page_end as pend,
           c.text as ctext,
           s.id as sid,
           s.title as stitle,
           s.section_type as stype,
           s.position as spos,
           (ce.embedding <=> v_query) as dist
      from scope
      join public.papers p
        on p.id = scope.pid
       and p.user_id = v_uid
       and p.status = 'ready'
       and p.processing_completed_at is not null
      join public.paper_embedding_jobs j
        on j.paper_id = p.id
       and j.model_id = v_model
       and j.user_id = v_uid
       and j.status = 'complete'
       and j.source_completed_at = p.processing_completed_at
      join public.paper_chunks c
        on c.paper_id = p.id
       and c.user_id = v_uid
      join public.chunk_embeddings ce
        on ce.chunk_id = c.id
       and ce.model_id = v_model
       and ce.paper_id = c.paper_id
       and ce.user_id = v_uid
       and ce.content_hash is not null
      join public.paper_sections s
        on s.id = c.section_id
       and s.paper_id = c.paper_id
       and s.user_id = v_uid
     where (coalesce(p_include_references, false) or s.section_type <> 'references')
       and (p_min_similarity is null or (1 - (ce.embedding <=> v_query)) >= p_min_similarity)
     order by (ce.embedding <=> v_query), p.id, c.chunk_index
     limit v_limit
  )
  select (row_number() over (order by t.dist, t.pid, t.cidx))::int,
         (1 - t.dist)::double precision,
         t.pid, t.ptitle, t.cid, t.cidx, t.cstart, t.cend, t.pstart, t.pend,
         t.sid, t.stitle, t.stype, t.spos, t.ctext
    from top t
   order by t.dist, t.pid, t.cidx;
end;
$$;

-- Grants --------------------------------------------------------------------------------
-- Start from nothing for every API role (Supabase's default privileges would
-- otherwise grant EXECUTE on new functions to anon, authenticated and service_role),
-- then grant the two public RPCs to signed-in users only. The private helper gets no
-- grant at all: it is reachable only from the two functions above.
revoke all on function public.search_scope_paper_ids(uuid[], uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_search_coverage(uuid[], uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.search_paper_chunks(jsonb, text, uuid[], uuid, int, double precision, boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.get_search_coverage(uuid[], uuid) to authenticated;
grant execute on function public.search_paper_chunks(jsonb, text, uuid[], uuid, int, double precision, boolean) to authenticated;

commit;
