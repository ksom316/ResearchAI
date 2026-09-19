-- ResearchAI Phase 6A.3 fix: an explicit "written by this claim" marker on fields.
-- Follows 0010 (applied, left untouched as history). Run once in the Supabase SQL editor.
--
-- WHY: 0010's complete_paper_extraction decided whether a field was written by the
-- current run by comparing paper_extraction_fields.created_at (DEFAULT now()) with the
-- claim token (clock_timestamp()). now() is the START of the surrounding transaction, so
-- the comparison is only right when claim and stores happen to run in separate, later
-- transactions. Inside one transaction (as the verification script does) every field
-- looks older than the claim and no run can ever be 'complete'. Timestamp inference is
-- not a run identity.
--
-- FIX: paper_extraction_fields.claim_started_at records the exact claim token of the run
-- that wrote the field. store_extraction_field sets it on every write;
-- complete_paper_extraction requires all seven fields to carry the CURRENT token. Rows
-- written before this migration have NULL and therefore never count as current-run.
-- The column is not granted to browsers (0009's column grants list columns explicitly).
--
-- complete_paper_extraction also becomes stricter for the no-LLM case: NULL provider/model
-- requires exactly seven fields, all written by this claim, all 'not_reported'.
-- store_extraction_field is 0009's function verbatim except for the marker.
begin;

alter table public.paper_extraction_fields
  add column claim_started_at timestamptz;

-- Replaces ONE field (and its sources) for the claimed run (0009 behavior + run marker).
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
    (paper_id, schema_version, field_key, user_id, state, value, claim_started_at)
  values (p_paper_id, p_schema_version, p_field_key, v_user, p_state, p_value,
          p_claim_started_at);

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

-- complete_paper_extraction:
--   * p_provider / p_model: both NULL (no LLM ran) or both non-blank (an LLM ran)
--   * NULL/NULL: exactly seven fields, ALL written by this claim, ALL 'not_reported'
--   * 'complete' needs all seven fields written by this claim and none failed; anything
--     else (e.g. a field left over from an earlier run) ends 'partial'
--   * fencing (token, ready paper, generation) as before
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
  v_extracted int;
  v_this_run int;
  v_provider text;
  v_model text;
  v_status text;
begin
  if (p_provider is null) <> (p_model is null) then
    raise exception 'provider and model must be given together';
  end if;
  if p_provider is not null then
    if p_provider !~ '\S' or p_model !~ '\S' then
      raise exception 'provider and model must not be blank';
    end if;
    v_provider := left(btrim(p_provider, E' \t\r\n'), 100);
    v_model := left(btrim(p_model, E' \t\r\n'), 200);
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

  select count(*)::int,
         count(*) filter (where f.state = 'failed')::int,
         count(*) filter (where f.state = 'extracted')::int,
         count(*) filter (where f.claim_started_at = p_claim_started_at)::int
    into v_fields, v_failed, v_extracted, v_this_run
    from public.paper_extraction_fields f
   where f.paper_id = p_paper_id and f.schema_version = p_schema_version;
  if v_fields = 0 then
    raise exception 'cannot complete an extraction with no stored fields';
  end if;
  if v_provider is null
     and (v_fields <> 7 or v_this_run <> 7 or v_failed > 0 or v_extracted > 0) then
    raise exception 'a NULL provider requires all seven fields written by this claim as not_reported';
  end if;

  v_status := case when v_fields = 7 and v_failed = 0 and v_this_run = 7
                   then 'complete' else 'partial' end;

  update public.paper_extractions e
     set status = v_status,
         claim_started_at = null,
         completed_at = now(),
         provider = v_provider,
         model = v_model,
         last_error = null
   where e.paper_id = p_paper_id and e.schema_version = p_schema_version;

  return v_status;
end;
$$;

-- Privileges (CREATE OR REPLACE keeps them; restated so the file stands on its own).
revoke all on function public.store_extraction_field(uuid, int, timestamptz, text, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.complete_paper_extraction(uuid, int, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.store_extraction_field(uuid, int, timestamptz, text, text, jsonb, jsonb) to service_role;
grant execute on function public.complete_paper_extraction(uuid, int, timestamptz, text, text) to service_role;

commit;
