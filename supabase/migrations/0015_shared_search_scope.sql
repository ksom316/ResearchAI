-- R10 follow-up: semantic search must use the authorized project's paper scope,
-- while processing/index rows remain owned by the paper uploader.
begin;

create or replace function public.get_search_coverage(
  p_paper_ids uuid[] default null, p_project_id uuid default null
) returns table (paper_id uuid, paper_title text, state text, chunk_count int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_model text;
begin
  if auth.uid() is null then raise exception 'search_unauthenticated' using errcode = '28000'; end if;
  select id into v_model from public.embedding_models where status = 'active';
  return query
  select p.id, p.title,
    case when p.status in ('uploaded','processing') then 'pdf_processing'
         when p.status = 'failed' then 'pdf_failed'
         when j.paper_id is null then 'not_indexed'
         when j.source_completed_at is distinct from p.processing_completed_at then 'index_stale'
         when j.status = 'complete' then 'searchable'
         when j.status = 'failed' then 'index_failed'
         when j.status = 'embedding' then 'indexing' else 'index_pending' end,
    (select count(*)::int from public.paper_chunks c where c.paper_id = p.id)
  from public.papers p
  left join public.paper_embedding_jobs j on j.paper_id = p.id and j.model_id = v_model and j.user_id = p.user_id
  where p.id in (select sc from public.search_scope_paper_ids(p_paper_ids, p_project_id) sc)
  order by p.title, p.id;
end; $$;

create or replace function public.search_paper_chunks(
  p_query_embedding jsonb, p_expected_model_id text,
  p_paper_ids uuid[] default null, p_project_id uuid default null,
  p_limit int default 10, p_min_similarity double precision default null,
  p_include_references boolean default false
) returns table (
  rank int, similarity double precision, paper_id uuid, paper_title text,
  chunk_id uuid, chunk_index int, char_start int, char_end int,
  page_start int, page_end int, section_id uuid, section_title text,
  section_type text, section_position int, content text
)
language plpgsql stable security definer set search_path = extensions, pg_temp as $$
#variable_conflict use_column
declare
  v_model text; v_query vector(1024); v_limit int;
begin
  if auth.uid() is null then raise exception 'search_unauthenticated' using errcode = '28000'; end if;
  if p_expected_model_id is null or (p_min_similarity is not null and (p_min_similarity < -1 or p_min_similarity > 1))
    then raise exception 'search_invalid_argument' using errcode = '22023'; end if;
  if p_query_embedding is null or jsonb_typeof(p_query_embedding) <> 'array' or jsonb_array_length(p_query_embedding) <> 1024
    then raise exception 'search_invalid_embedding' using errcode = '22023'; end if;
  begin v_query := (p_query_embedding::text)::vector(1024); exception when others then raise exception 'search_invalid_embedding' using errcode = '22023'; end;
  if (v_query <#> v_query) = 0 then raise exception 'search_invalid_embedding' using errcode = '22023'; end if;
  v_limit := least(greatest(coalesce(p_limit, 10), 1), 50);
  select id into v_model from public.embedding_models where status = 'active';
  if v_model is null or v_model <> p_expected_model_id then raise exception 'search_model_mismatch' using errcode = 'P0001'; end if;
  return query
  with scope as (select sc as pid from public.search_scope_paper_ids(p_paper_ids, p_project_id) sc),
  top as (
    select p.id pid, p.title ptitle, c.id cid, c.chunk_index cidx, c.char_start cstart,
      c.char_end cend, c.page_start pstart, c.page_end pend, c.text ctext,
      s.id sid, s.title stitle, s.section_type stype, s.position spos,
      (ce.embedding <=> v_query) dist
    from scope join public.papers p on p.id = scope.pid and p.status = 'ready' and p.processing_completed_at is not null
    join public.paper_embedding_jobs j on j.paper_id = p.id and j.model_id = v_model and j.user_id = p.user_id
      and j.status = 'complete' and j.source_completed_at = p.processing_completed_at
    join public.paper_chunks c on c.paper_id = p.id and c.user_id = p.user_id
    join public.chunk_embeddings ce on ce.chunk_id = c.id and ce.model_id = v_model and ce.paper_id = c.paper_id
      and ce.user_id = p.user_id and ce.content_hash is not null
    join public.paper_sections s on s.id = c.section_id and s.paper_id = c.paper_id and s.user_id = p.user_id
    where (coalesce(p_include_references, false) or s.section_type <> 'references')
      and (p_min_similarity is null or (1 - (ce.embedding <=> v_query)) >= p_min_similarity)
    order by (ce.embedding <=> v_query), p.id, c.chunk_index limit v_limit
  )
  select (row_number() over (order by t.dist, t.pid, t.cidx))::int, (1 - t.dist)::double precision,
    t.pid, t.ptitle, t.cid, t.cidx, t.cstart, t.cend, t.pstart, t.pend, t.sid, t.stitle,
    t.stype, t.spos, t.ctext from top t order by t.dist, t.pid, t.cidx;
end; $$;

commit;
