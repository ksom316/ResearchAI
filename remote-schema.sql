


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."claim_next_embedding_job"("p_paper_id" "uuid" DEFAULT NULL::"uuid", "p_max_attempts" integer DEFAULT 4, "p_stale_after" interval DEFAULT '00:15:00'::interval) RETURNS TABLE("paper_id" "uuid", "user_id" "uuid", "model_id" "text", "claim_started_at" timestamp with time zone, "source_completed_at" timestamp with time zone, "attempts" integer, "chunk_count" integer, "provider" "text", "provider_model" "text", "dimensions" integer, "input_profile" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
#variable_conflict use_column
declare
  v_model text;
begin
  select m.id into v_model
    from public.embedding_models m
   where m.status = 'active';
  if v_model is null then
    return;
  end if;

  insert into public.paper_embedding_jobs
    (paper_id, model_id, user_id, source_completed_at)
  select p.id, v_model, p.user_id, p.processing_completed_at
    from public.papers p
   where p.status = 'ready'
     and p.processing_completed_at is not null
     and (p_paper_id is null or p.id = p_paper_id)
     and exists (select 1 from public.paper_chunks c where c.paper_id = p.id)
     and not exists (
       select 1 from public.paper_embedding_jobs j
        where j.paper_id = p.id and j.model_id = v_model
     )
  on conflict (paper_id, model_id) do nothing;

  update public.paper_embedding_jobs j
     set status = 'pending',
         attempts = 0,
         source_completed_at = p.processing_completed_at,
         claim_started_at = null,
         completed_at = null,
         chunk_count = null,
         embedded_count = 0,
         last_error = null,
         next_attempt_at = null
    from public.papers p
   where p.id = j.paper_id
     and j.model_id = v_model
     and (p_paper_id is null or j.paper_id = p_paper_id)
     and p.status = 'ready'
     and p.processing_completed_at is not null
     and j.source_completed_at is distinct from p.processing_completed_at;

  update public.paper_embedding_jobs j
     set status = 'failed',
         claim_started_at = null,
         completed_at = now(),
         last_error = 'Indexing was interrupted repeatedly and was stopped.'
   where j.model_id = v_model
     and (p_paper_id is null or j.paper_id = p_paper_id)
     and j.status = 'embedding'
     and j.updated_at < now() - p_stale_after
     and j.attempts >= p_max_attempts;

  return query
  with candidate as (
    select j.paper_id as pid
      from public.paper_embedding_jobs j
      join public.papers p on p.id = j.paper_id
     where j.model_id = v_model
       and (p_paper_id is null or j.paper_id = p_paper_id)
       and p.status = 'ready'
       and j.source_completed_at = p.processing_completed_at
       and j.attempts < p_max_attempts
       and (j.next_attempt_at is null or j.next_attempt_at <= now())
       and (
         j.status = 'pending'
         or (j.status = 'embedding' and j.updated_at < now() - p_stale_after)
       )
     order by j.created_at
     limit 1
       for update of j skip locked
  ), claimed as (
    update public.paper_embedding_jobs j
       set status = 'embedding',
           claim_started_at = clock_timestamp(),
           attempts = j.attempts + 1,
           completed_at = null,
           last_error = null,
           next_attempt_at = null,
           chunk_count = (
             select count(*)::int from public.paper_chunks c
              where c.paper_id = j.paper_id
           ),
           embedded_count = (
             select count(*)::int from public.chunk_embeddings ce
              where ce.paper_id = j.paper_id and ce.model_id = v_model
           )
      from candidate
     where j.paper_id = candidate.pid
       and j.model_id = v_model
    returning j.paper_id, j.user_id, j.model_id, j.claim_started_at,
              j.source_completed_at, j.attempts, j.chunk_count
  )
  select c.paper_id, c.user_id, c.model_id, c.claim_started_at,
         c.source_completed_at, c.attempts, c.chunk_count,
         m.provider, m.provider_model, m.dimensions, m.input_profile
    from claimed c
    join public.embedding_models m on m.id = c.model_id;
end;
$$;


ALTER FUNCTION "public"."claim_next_embedding_job"("p_paper_id" "uuid", "p_max_attempts" integer, "p_stale_after" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_paper"("p_max_attempts" integer DEFAULT 3, "p_stale_after" interval DEFAULT '00:15:00'::interval) RETURNS TABLE("id" "uuid", "user_id" "uuid", "storage_path" "text", "processing_started_at" timestamp with time zone, "processing_attempts" integer)
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
#variable_conflict use_column
begin
  -- Abandoned jobs that already used all their attempts are failed, not retried
  -- forever.
  update public.papers p
     set status = 'failed',
         processing_completed_at = now(),
         processing_error = 'Processing was interrupted repeatedly and was stopped.'
   where p.status = 'processing'
     and p.processing_started_at < now() - p_stale_after
     and p.processing_attempts >= p_max_attempts;

  return query
  with candidate as (
    select c.id
      from public.papers c
     where c.storage_path is not null
       and c.processing_attempts < p_max_attempts
       and (
         c.status = 'uploaded'
         or (c.status = 'processing'
             and c.processing_started_at < now() - p_stale_after)
       )
     order by c.created_at
     limit 1
       for update skip locked
  )
  update public.papers p
     set status = 'processing',
         processing_started_at = clock_timestamp(),
         processing_completed_at = null,
         processing_error = null,
         processing_attempts = p.processing_attempts + 1
    from candidate
   where p.id = candidate.id
  returning p.id, p.user_id, p.storage_path,
            p.processing_started_at, p.processing_attempts;
end;
$$;


ALTER FUNCTION "public"."claim_next_paper"("p_max_attempts" integer, "p_stale_after" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_paper_extraction"("p_schema_version" integer, "p_max_attempts" integer DEFAULT 3, "p_stale_after" interval DEFAULT '00:15:00'::interval) RETURNS TABLE("paper_id" "uuid", "user_id" "uuid", "schema_version" integer, "source_completed_at" timestamp with time zone, "claim_started_at" timestamp with time zone, "attempts" integer)
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
#variable_conflict use_column
declare
  v_paper uuid;
begin
  if p_max_attempts is null or p_max_attempts not between 1 and 10 then
    raise exception 'invalid max attempts';
  end if;

  update public.paper_extractions e
     set status = 'failed',
         claim_started_at = null,
         completed_at = null,
         last_error = 'Extraction was abandoned after the maximum number of attempts.'
   where e.schema_version = p_schema_version
     and e.status = 'running'
     and e.updated_at < now() - p_stale_after
     and e.attempts >= p_max_attempts;

  select e.paper_id
    into v_paper
    from public.paper_extractions e
    join public.papers p on p.id = e.paper_id
   where e.schema_version = p_schema_version
     and p.status = 'ready'
     and p.processing_completed_at is not null
     and (
       e.status = 'pending'
       or (e.status = 'running'
           and e.updated_at < now() - p_stale_after
           and e.attempts < p_max_attempts)
     )
   order by e.updated_at, e.paper_id
   limit 1
     for update of e skip locked;
  if not found then
    return;
  end if;

  return query
  select c.paper_id, c.user_id, c.schema_version, c.source_completed_at,
         c.claim_started_at, c.attempts
    from public.claim_paper_extraction(v_paper, p_schema_version, p_stale_after) c;
end;
$$;


ALTER FUNCTION "public"."claim_next_paper_extraction"("p_schema_version" integer, "p_max_attempts" integer, "p_stale_after" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_stale_after" interval DEFAULT '00:15:00'::interval) RETURNS TABLE("paper_id" "uuid", "user_id" "uuid", "schema_version" integer, "source_completed_at" timestamp with time zone, "claim_started_at" timestamp with time zone, "attempts" integer)
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."claim_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_stale_after" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_embedding_job"("p_paper_id" "uuid", "p_model_id" "text", "p_claim_started_at" timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_chunks int;
  v_embedded int;
begin
  perform 1
     from public.paper_embedding_jobs j
     join public.papers p on p.id = j.paper_id
     join public.embedding_models m on m.id = j.model_id
    where j.paper_id = p_paper_id
      and j.model_id = p_model_id
      and j.status = 'embedding'
      and j.claim_started_at = p_claim_started_at
      and p.status = 'ready'
      and j.source_completed_at = p.processing_completed_at
      and m.status = 'active'
      for update of j;
  if not found then
    return false;
  end if;

  select count(*)::int into v_chunks
    from public.paper_chunks c
   where c.paper_id = p_paper_id;

  select count(*)::int into v_embedded
    from public.paper_chunks c
    join public.chunk_embeddings ce on ce.chunk_id = c.id and ce.model_id = p_model_id
   where c.paper_id = p_paper_id
     and ce.content_hash is not null;

  if v_chunks = 0 or v_embedded <> v_chunks then
    raise exception 'cannot complete embedding job: % of % chunks are embedded',
      v_embedded, v_chunks;
  end if;

  update public.paper_embedding_jobs j
     set status = 'complete',
         claim_started_at = null,
         completed_at = now(),
         chunk_count = v_chunks,
         embedded_count = v_embedded,
         last_error = null,
         next_attempt_at = null
   where j.paper_id = p_paper_id and j.model_id = p_model_id;

  return true;
end;
$$;


ALTER FUNCTION "public"."complete_embedding_job"("p_paper_id" "uuid", "p_model_id" "text", "p_claim_started_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone, "p_provider" "text", "p_model" "text") RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."complete_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone, "p_provider" "text", "p_model" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_paper_processing"("p_paper_id" "uuid", "p_started_at" timestamp with time zone, "p_page_count" integer, "p_sections" "jsonb", "p_chunks" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
begin
  select p.user_id
    into v_user_id
    from public.papers p
   where p.id = p_paper_id
     and p.status = 'processing'
     and p.processing_started_at = p_started_at
     for update;
  if not found then
    return false;
  end if;

  -- Idempotent on retry: old derived rows go first (chunks cascade).
  delete from public.paper_sections s where s.paper_id = p_paper_id;

  insert into public.paper_sections
    (id, paper_id, user_id, "position", title, section_type, page_start, page_end, text)
  select x.id, p_paper_id, v_user_id, x."position", x.title, x.section_type,
         x.page_start, x.page_end, x.text
    from jsonb_to_recordset(coalesce(p_sections, '[]'::jsonb)) as x(
      id uuid, "position" int, title text, section_type text,
      page_start int, page_end int, text text
    );

  insert into public.paper_chunks
    (id, paper_id, user_id, section_id, chunk_index, text,
     char_start, char_end, page_start, page_end)
  select x.id, p_paper_id, v_user_id, x.section_id, x.chunk_index, x.text,
         x.char_start, x.char_end, x.page_start, x.page_end
    from jsonb_to_recordset(coalesce(p_chunks, '[]'::jsonb)) as x(
      id uuid, section_id uuid, chunk_index int, text text,
      char_start int, char_end int, page_start int, page_end int
    );

  update public.papers p
     set status = 'ready',
         processing_completed_at = now(),
         processing_error = null,
         page_count = p_page_count
   where p.id = p_paper_id;

  return true;
end;
$$;


ALTER FUNCTION "public"."complete_paper_processing"("p_paper_id" "uuid", "p_started_at" timestamp with time zone, "p_page_count" integer, "p_sections" "jsonb", "p_chunks" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."embedding_models_protect_identity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."embedding_models_protect_identity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_embedding_job"("p_paper_id" "uuid", "p_model_id" "text", "p_claim_started_at" timestamp with time zone, "p_error" "text", "p_retry" boolean, "p_count_attempt" boolean DEFAULT true, "p_retry_delay" interval DEFAULT '00:00:00'::interval) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  perform 1
     from public.paper_embedding_jobs j
    where j.paper_id = p_paper_id
      and j.model_id = p_model_id
      and j.status = 'embedding'
      and j.claim_started_at = p_claim_started_at
      for update;
  if not found then
    return false;
  end if;

  if p_retry then
    update public.paper_embedding_jobs j
       set status = 'pending',
           claim_started_at = null,
           completed_at = null,
           last_error = null,
           next_attempt_at = now() + p_retry_delay,
           attempts = case when p_count_attempt then j.attempts
                           else greatest(j.attempts - 1, 0) end
     where j.paper_id = p_paper_id and j.model_id = p_model_id;
  else
    update public.paper_embedding_jobs j
       set status = 'failed',
           claim_started_at = null,
           completed_at = now(),
           next_attempt_at = null,
           last_error = coalesce(left(nullif(trim(p_error), ''), 1000), 'Indexing failed.')
     where j.paper_id = p_paper_id and j.model_id = p_model_id;
  end if;

  return true;
end;
$$;


ALTER FUNCTION "public"."fail_embedding_job"("p_paper_id" "uuid", "p_model_id" "text", "p_claim_started_at" timestamp with time zone, "p_error" "text", "p_retry" boolean, "p_count_attempt" boolean, "p_retry_delay" interval) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone, "p_error" "text") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."fail_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone, "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_paper_processing"("p_paper_id" "uuid", "p_started_at" timestamp with time zone, "p_error" "text", "p_retry" boolean) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  perform 1
     from public.papers p
    where p.id = p_paper_id
      and p.status = 'processing'
      and p.processing_started_at = p_started_at
      for update;
  if not found then
    return false;
  end if;

  delete from public.paper_sections s where s.paper_id = p_paper_id;

  if p_retry then
    update public.papers p
       set status = 'uploaded',
           processing_started_at = null,
           processing_completed_at = null,
           processing_error = null
     where p.id = p_paper_id;
  else
    update public.papers p
       set status = 'failed',
           processing_completed_at = now(),
           processing_error = coalesce(left(p_error, 1000), 'Processing failed.')
     where p.id = p_paper_id;
  end if;

  return true;
end;
$$;


ALTER FUNCTION "public"."fail_paper_processing"("p_paper_id" "uuid", "p_started_at" timestamp with time zone, "p_error" "text", "p_retry" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_search_coverage"("p_paper_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_project_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("paper_id" "uuid", "paper_title" "text", "state" "text", "chunk_count" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."get_search_coverage"("p_paper_ids" "uuid"[], "p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."request_paper_extraction"("p_paper_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_generation timestamptz;
  v_inserted int;
  e_status text;
  e_generation timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select p.status, p.processing_completed_at
    into v_status, v_generation
    from public.papers p
   where p.id = p_paper_id and p.user_id = v_uid
     for key share;
  if not found then
    return 'not_found';
  end if;
  if v_status <> 'ready' or v_generation is null then
    return 'not_ready';
  end if;

  insert into public.paper_extractions (paper_id, schema_version, user_id, source_completed_at)
  values (p_paper_id, 1, v_uid, v_generation)
  on conflict (paper_id, schema_version) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return 'requested';
  end if;

  select e.status, e.source_completed_at
    into e_status, e_generation
    from public.paper_extractions e
   where e.paper_id = p_paper_id and e.schema_version = 1 and e.user_id = v_uid
     for update;
  if not found then
    return 'not_found';
  end if;

  -- Complete for the CURRENT generation, or already queued/running for it: no-op.
  if e_generation is not distinct from v_generation
     and e_status in ('pending', 'running', 'complete') then
    return 'unchanged';
  end if;

  -- failed / partial (retry) or an older generation (regenerate, whatever its status):
  -- make it claimable again. source_completed_at is deliberately left alone, so the
  -- worker claim sees the mismatch and performs the generation reset itself.
  update public.paper_extractions e
     set status = 'pending',
         attempts = 0,
         claim_started_at = null,
         completed_at = null,
         last_error = null
   where e.paper_id = p_paper_id and e.schema_version = 1;
  return 'requested';
end;
$$;


ALTER FUNCTION "public"."request_paper_extraction"("p_paper_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."retry_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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
     set status = 'pending',
         claim_started_at = null,
         completed_at = null,
         last_error = null
   where e.paper_id = p_paper_id and e.schema_version = p_schema_version;
  return true;
end;
$$;


ALTER FUNCTION "public"."retry_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_paper_chunks"("p_query_embedding" "jsonb", "p_expected_model_id" "text", "p_paper_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_project_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 10, "p_min_similarity" double precision DEFAULT NULL::double precision, "p_include_references" boolean DEFAULT false) RETURNS TABLE("rank" integer, "similarity" double precision, "paper_id" "uuid", "paper_title" "text", "chunk_id" "uuid", "chunk_index" integer, "char_start" integer, "char_end" integer, "page_start" integer, "page_end" integer, "section_id" "uuid", "section_title" "text", "section_type" "text", "section_position" integer, "content" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'extensions', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."search_paper_chunks"("p_query_embedding" "jsonb", "p_expected_model_id" "text", "p_paper_ids" "uuid"[], "p_project_id" "uuid", "p_limit" integer, "p_min_similarity" double precision, "p_include_references" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_scope_paper_ids"("p_paper_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_project_id" "uuid" DEFAULT NULL::"uuid") RETURNS SETOF "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."search_scope_paper_ids"("p_paper_ids" "uuid"[], "p_project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."store_chunk_embeddings"("p_paper_id" "uuid", "p_model_id" "text", "p_claim_started_at" timestamp with time zone, "p_rows" "jsonb") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'extensions', 'pg_temp'
    AS $$
declare
  v_user_id uuid;
  v_stored int;
begin
  if p_rows is null
     or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'p_rows must be a JSON array of 1 to 200 embeddings';
  end if;

  select j.user_id
    into v_user_id
    from public.paper_embedding_jobs j
    join public.papers p on p.id = j.paper_id
    join public.embedding_models m on m.id = j.model_id
   where j.paper_id = p_paper_id
     and j.model_id = p_model_id
     and j.status = 'embedding'
     and j.claim_started_at = p_claim_started_at
     and p.status = 'ready'
     and j.source_completed_at = p.processing_completed_at
     and m.status = 'active'
     for update of j;
  if not found then
    return -1;
  end if;

  insert into public.chunk_embeddings
    (chunk_id, model_id, paper_id, user_id, embedding, content_hash)
  select x.chunk_id, p_model_id, p_paper_id, v_user_id,
         (x.embedding::text)::vector(1024), x.content_hash
    from jsonb_to_recordset(p_rows) as x(chunk_id uuid, embedding jsonb, content_hash text)
  on conflict (chunk_id, model_id) do update
     set embedding = excluded.embedding,
         content_hash = excluded.content_hash,
         created_at = now();

  select count(*)::int
    into v_stored
    from public.chunk_embeddings ce
   where ce.paper_id = p_paper_id and ce.model_id = p_model_id;

  -- Also serves as the job's heartbeat (updated_at) for stalled-job detection.
  update public.paper_embedding_jobs j
     set embedded_count = v_stored
   where j.paper_id = p_paper_id and j.model_id = p_model_id;

  return v_stored;
end;
$$;


ALTER FUNCTION "public"."store_chunk_embeddings"("p_paper_id" "uuid", "p_model_id" "text", "p_claim_started_at" timestamp with time zone, "p_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."store_extraction_field"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone, "p_field_key" "text", "p_state" "text", "p_value" "jsonb", "p_sources" "jsonb" DEFAULT '[]'::"jsonb") RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."store_extraction_field"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone, "p_field_key" "text", "p_state" "text", "p_value" "jsonb", "p_sources" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."chunk_embeddings" (
    "chunk_id" "uuid" NOT NULL,
    "model_id" "text" NOT NULL,
    "paper_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "embedding" "extensions"."vector"(1024) NOT NULL,
    "content_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chunk_embeddings_content_hash_check" CHECK ((("content_hash" IS NULL) OR ("content_hash" ~ '^[0-9a-f]{64}$'::"text")))
);


ALTER TABLE "public"."chunk_embeddings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."embedding_models" (
    "id" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_model" "text" NOT NULL,
    "dimensions" integer NOT NULL,
    "input_profile" "text" NOT NULL,
    "distance" "text" DEFAULT 'cosine'::"text" NOT NULL,
    "status" "text" DEFAULT 'building'::"text" NOT NULL,
    "min_similarity" real,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activated_at" timestamp with time zone,
    "retired_at" timestamp with time zone,
    CONSTRAINT "embedding_models_dimensions_check" CHECK (("dimensions" = 1024)),
    CONSTRAINT "embedding_models_distance_check" CHECK (("distance" = 'cosine'::"text")),
    CONSTRAINT "embedding_models_id_check" CHECK (("id" ~ '^[a-z0-9][a-z0-9._:-]{2,99}$'::"text")),
    CONSTRAINT "embedding_models_input_profile_check" CHECK (("input_profile" ~ '^[a-z0-9][a-z0-9._-]{0,49}$'::"text")),
    CONSTRAINT "embedding_models_min_similarity_check" CHECK ((("min_similarity" IS NULL) OR (("min_similarity" >= ('-1'::integer)::double precision) AND ("min_similarity" <= (1)::double precision)))),
    CONSTRAINT "embedding_models_provider_check" CHECK (("provider" ~ '^[a-z0-9][a-z0-9_-]{0,49}$'::"text")),
    CONSTRAINT "embedding_models_provider_model_check" CHECK ((("char_length"("provider_model") >= 1) AND ("char_length"("provider_model") <= 100))),
    CONSTRAINT "embedding_models_status_check" CHECK (("status" = ANY (ARRAY['building'::"text", 'active'::"text", 'retired'::"text"])))
);


ALTER TABLE "public"."embedding_models" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."paper_chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "paper_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "section_id" "uuid" NOT NULL,
    "chunk_index" integer NOT NULL,
    "text" "text" NOT NULL,
    "char_start" integer NOT NULL,
    "char_end" integer NOT NULL,
    "char_count" integer GENERATED ALWAYS AS ("char_length"("text")) STORED,
    "page_start" integer,
    "page_end" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "paper_chunks_char_start_check" CHECK (("char_start" >= 0)),
    CONSTRAINT "paper_chunks_check" CHECK (("char_end" > "char_start")),
    CONSTRAINT "paper_chunks_check1" CHECK ((("page_start" IS NULL) OR ("page_end" IS NULL) OR ("page_start" <= "page_end"))),
    CONSTRAINT "paper_chunks_chunk_index_check" CHECK (("chunk_index" >= 0)),
    CONSTRAINT "paper_chunks_page_end_check" CHECK ((("page_end" IS NULL) OR ("page_end" >= 1))),
    CONSTRAINT "paper_chunks_page_start_check" CHECK ((("page_start" IS NULL) OR ("page_start" >= 1))),
    CONSTRAINT "paper_chunks_text_check" CHECK (("char_length"("text") > 0))
);


ALTER TABLE "public"."paper_chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."paper_embedding_jobs" (
    "paper_id" "uuid" NOT NULL,
    "model_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "source_completed_at" timestamp with time zone NOT NULL,
    "claim_started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "chunk_count" integer,
    "embedded_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "next_attempt_at" timestamp with time zone,
    CONSTRAINT "paper_embedding_jobs_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "paper_embedding_jobs_chunk_count_check" CHECK ((("chunk_count" IS NULL) OR ("chunk_count" >= 0))),
    CONSTRAINT "paper_embedding_jobs_consistency_check" CHECK (((("status" = 'embedding'::"text") = ("claim_started_at" IS NOT NULL)) AND (("status" = 'failed'::"text") = ("last_error" IS NOT NULL)) AND (("status" <> 'complete'::"text") OR (("completed_at" IS NOT NULL) AND ("chunk_count" IS NOT NULL) AND ("embedded_count" = "chunk_count"))) AND (("chunk_count" IS NULL) OR ("embedded_count" <= "chunk_count")))),
    CONSTRAINT "paper_embedding_jobs_embedded_count_check" CHECK (("embedded_count" >= 0)),
    CONSTRAINT "paper_embedding_jobs_last_error_check" CHECK ((("last_error" IS NULL) OR ("char_length"("last_error") <= 1000))),
    CONSTRAINT "paper_embedding_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'embedding'::"text", 'complete'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."paper_embedding_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."paper_extraction_fields" (
    "paper_id" "uuid" NOT NULL,
    "schema_version" integer NOT NULL,
    "field_key" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "state" "text" NOT NULL,
    "value" "jsonb" DEFAULT '{"items": []}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "claim_started_at" timestamp with time zone,
    CONSTRAINT "paper_extraction_fields_field_key_check" CHECK (("field_key" = ANY (ARRAY['objective'::"text", 'methodology'::"text", 'dataset'::"text", 'findings'::"text", 'limitations'::"text", 'future_work'::"text", 'concepts'::"text"]))),
    CONSTRAINT "paper_extraction_fields_state_check" CHECK (("state" = ANY (ARRAY['extracted'::"text", 'not_reported'::"text", 'failed'::"text"]))),
    CONSTRAINT "paper_extraction_fields_value_check" CHECK ((("jsonb_typeof"("value") = 'object'::"text") AND ("octet_length"(("value")::"text") <= 20000) AND
CASE
    WHEN ("state" = 'extracted'::"text") THEN ((COALESCE(
    CASE
        WHEN ("jsonb_typeof"(("value" -> 'items'::"text")) = 'array'::"text") THEN "jsonb_array_length"(("value" -> 'items'::"text"))
        ELSE NULL::integer
    END, '-1'::integer) >= 1) AND (COALESCE(
    CASE
        WHEN ("jsonb_typeof"(("value" -> 'items'::"text")) = 'array'::"text") THEN "jsonb_array_length"(("value" -> 'items'::"text"))
        ELSE NULL::integer
    END, '-1'::integer) <= 12))
    ELSE ((("value" -> 'items'::"text") IS NULL) OR (COALESCE(
    CASE
        WHEN ("jsonb_typeof"(("value" -> 'items'::"text")) = 'array'::"text") THEN "jsonb_array_length"(("value" -> 'items'::"text"))
        ELSE NULL::integer
    END, '-1'::integer) = 0))
END))
);


ALTER TABLE "public"."paper_extraction_fields" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."paper_extractions" (
    "paper_id" "uuid" NOT NULL,
    "schema_version" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source_completed_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "claim_started_at" timestamp with time zone,
    "provider" "text",
    "model" "text",
    "completed_at" timestamp with time zone,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "paper_extractions_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "paper_extractions_consistency_check" CHECK (((("status" = 'running'::"text") = ("claim_started_at" IS NOT NULL)) AND (("status" = 'failed'::"text") = ("last_error" IS NOT NULL)) AND (("status" <> ALL (ARRAY['complete'::"text", 'partial'::"text"])) OR ("completed_at" IS NOT NULL)) AND (("provider" IS NULL) = ("model" IS NULL)))),
    CONSTRAINT "paper_extractions_last_error_check" CHECK ((("last_error" IS NULL) OR ("char_length"("last_error") <= 500))),
    CONSTRAINT "paper_extractions_model_check" CHECK ((("model" IS NULL) OR (("char_length"("model") >= 1) AND ("char_length"("model") <= 200)))),
    CONSTRAINT "paper_extractions_provider_check" CHECK ((("provider" IS NULL) OR (("char_length"("provider") >= 1) AND ("char_length"("provider") <= 100)))),
    CONSTRAINT "paper_extractions_schema_version_check" CHECK ((("schema_version" >= 1) AND ("schema_version" <= 1000))),
    CONSTRAINT "paper_extractions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'complete'::"text", 'partial'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."paper_extractions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."papers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "title" "text" NOT NULL,
    "authors" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "publication_year" integer,
    "storage_path" "text",
    "file_size_bytes" bigint,
    "status" "text" DEFAULT 'uploaded'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "original_filename" "text",
    "mime_type" "text",
    "content_hash" "text",
    "processing_started_at" timestamp with time zone,
    "processing_completed_at" timestamp with time zone,
    "processing_error" "text",
    "page_count" integer,
    "processing_attempts" integer DEFAULT 0 NOT NULL,
    "citation_title" "text",
    "citation_container_title" "text",
    "citation_publisher" "text",
    "citation_doi" "text",
    "citation_url" "text",
    "citation_volume" "text",
    "citation_issue" "text",
    "citation_pages" "text",
    CONSTRAINT "papers_citation_container_title_check" CHECK ((("citation_container_title" IS NULL) OR (("char_length"(TRIM(BOTH FROM "citation_container_title")) >= 1) AND ("char_length"(TRIM(BOTH FROM "citation_container_title")) <= 500)))),
    CONSTRAINT "papers_citation_doi_check" CHECK ((("citation_doi" IS NULL) OR (("char_length"("citation_doi") <= 255) AND ("citation_doi" ~* '^10\.[0-9]{4,9}/[-._;()/:+A-Z0-9]+$'::"text")))),
    CONSTRAINT "papers_citation_issue_check" CHECK ((("citation_issue" IS NULL) OR (("char_length"(TRIM(BOTH FROM "citation_issue")) >= 1) AND ("char_length"(TRIM(BOTH FROM "citation_issue")) <= 50)))),
    CONSTRAINT "papers_citation_pages_check" CHECK ((("citation_pages" IS NULL) OR (("char_length"(TRIM(BOTH FROM "citation_pages")) >= 1) AND ("char_length"(TRIM(BOTH FROM "citation_pages")) <= 100)))),
    CONSTRAINT "papers_citation_publisher_check" CHECK ((("citation_publisher" IS NULL) OR (("char_length"(TRIM(BOTH FROM "citation_publisher")) >= 1) AND ("char_length"(TRIM(BOTH FROM "citation_publisher")) <= 300)))),
    CONSTRAINT "papers_citation_title_check" CHECK ((("citation_title" IS NULL) OR (("char_length"(TRIM(BOTH FROM "citation_title")) >= 1) AND ("char_length"(TRIM(BOTH FROM "citation_title")) <= 500)))),
    CONSTRAINT "papers_citation_url_check" CHECK ((("citation_url" IS NULL) OR (("char_length"("citation_url") <= 2048) AND ("citation_url" ~* '^https?://[^[:space:]]+$'::"text")))),
    CONSTRAINT "papers_citation_volume_check" CHECK ((("citation_volume" IS NULL) OR (("char_length"(TRIM(BOTH FROM "citation_volume")) >= 1) AND ("char_length"(TRIM(BOTH FROM "citation_volume")) <= 50)))),
    CONSTRAINT "papers_content_hash_check" CHECK ((("content_hash" IS NULL) OR ("content_hash" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "papers_file_size_bytes_check" CHECK ((("file_size_bytes" IS NULL) OR ("file_size_bytes" >= 0))),
    CONSTRAINT "papers_mime_type_check" CHECK ((("mime_type" IS NULL) OR ("char_length"("mime_type") <= 100))),
    CONSTRAINT "papers_original_filename_check" CHECK ((("original_filename" IS NULL) OR ("char_length"("original_filename") <= 255))),
    CONSTRAINT "papers_page_count_check" CHECK ((("page_count" IS NULL) OR ("page_count" > 0))),
    CONSTRAINT "papers_processing_attempts_check" CHECK (("processing_attempts" >= 0)),
    CONSTRAINT "papers_processing_consistency_check" CHECK (((("status" = 'failed'::"text") OR ("processing_error" IS NULL)) AND (("status" <> 'ready'::"text") OR (("processing_completed_at" IS NOT NULL) AND ("page_count" IS NOT NULL))))),
    CONSTRAINT "papers_processing_error_check" CHECK ((("processing_error" IS NULL) OR ("char_length"("processing_error") <= 1000))),
    CONSTRAINT "papers_publication_year_check" CHECK ((("publication_year" >= 1000) AND ("publication_year" <= 3000))),
    CONSTRAINT "papers_status_check" CHECK (("status" = ANY (ARRAY['uploaded'::"text", 'processing'::"text", 'ready'::"text", 'failed'::"text"]))),
    CONSTRAINT "papers_storage_path_owner_check" CHECK ((("storage_path" IS NULL) OR ("storage_path" ~~ (((("user_id")::"text" || '/'::"text") || ("id")::"text") || '/%'::"text")))),
    CONSTRAINT "papers_title_check" CHECK ((("char_length"(TRIM(BOTH FROM "title")) >= 1) AND ("char_length"(TRIM(BOTH FROM "title")) <= 500)))
);


ALTER TABLE "public"."papers" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."paper_extraction_overview" WITH ("security_invoker"='true') AS
 SELECT "e"."paper_id",
    "e"."schema_version",
    "e"."status",
    "e"."source_completed_at",
    "e"."completed_at",
    "e"."provider",
    "e"."model",
    "e"."created_at",
    "e"."updated_at",
    ("e"."source_completed_at" IS DISTINCT FROM "p"."processing_completed_at") AS "is_stale"
   FROM ("public"."paper_extractions" "e"
     JOIN "public"."papers" "p" ON (("p"."id" = "e"."paper_id")));


ALTER VIEW "public"."paper_extraction_overview" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."paper_extraction_sources" (
    "paper_id" "uuid" NOT NULL,
    "schema_version" integer NOT NULL,
    "field_key" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "item_index" integer NOT NULL,
    "ord" integer DEFAULT 0 NOT NULL,
    "chunk_id" "uuid",
    "section_id" "uuid",
    "section_title" "text" NOT NULL,
    "section_type" "text" NOT NULL,
    "page_start" integer,
    "page_end" integer,
    "excerpt" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "paper_extraction_sources_check" CHECK ((("page_start" IS NULL) OR ("page_end" IS NULL) OR ("page_start" <= "page_end"))),
    CONSTRAINT "paper_extraction_sources_excerpt_check" CHECK ((("excerpt" IS NULL) OR (("char_length"("excerpt") >= 1) AND ("char_length"("excerpt") <= 400)))),
    CONSTRAINT "paper_extraction_sources_item_index_check" CHECK ((("item_index" >= 0) AND ("item_index" <= 11))),
    CONSTRAINT "paper_extraction_sources_ord_check" CHECK ((("ord" >= 0) AND ("ord" <= 9))),
    CONSTRAINT "paper_extraction_sources_page_end_check" CHECK ((("page_end" IS NULL) OR ("page_end" >= 1))),
    CONSTRAINT "paper_extraction_sources_page_start_check" CHECK ((("page_start" IS NULL) OR ("page_start" >= 1))),
    CONSTRAINT "paper_extraction_sources_section_title_check" CHECK ((("char_length"("section_title") >= 1) AND ("char_length"("section_title") <= 300))),
    CONSTRAINT "paper_extraction_sources_section_type_check" CHECK (("section_type" = ANY (ARRAY['abstract'::"text", 'introduction'::"text", 'background'::"text", 'related_work'::"text", 'methods'::"text", 'results'::"text", 'discussion'::"text", 'conclusion'::"text", 'limitations'::"text", 'references'::"text", 'acknowledgments'::"text", 'appendix'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."paper_extraction_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."paper_project_links" (
    "paper_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."paper_project_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."paper_sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "paper_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "position" integer NOT NULL,
    "title" "text" NOT NULL,
    "section_type" "text" DEFAULT 'other'::"text" NOT NULL,
    "page_start" integer,
    "page_end" integer,
    "text" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "paper_sections_check" CHECK ((("page_start" IS NULL) OR ("page_end" IS NULL) OR ("page_start" <= "page_end"))),
    CONSTRAINT "paper_sections_page_end_check" CHECK ((("page_end" IS NULL) OR ("page_end" >= 1))),
    CONSTRAINT "paper_sections_page_start_check" CHECK ((("page_start" IS NULL) OR ("page_start" >= 1))),
    CONSTRAINT "paper_sections_position_check" CHECK (("position" >= 0)),
    CONSTRAINT "paper_sections_section_type_check" CHECK (("section_type" = ANY (ARRAY['abstract'::"text", 'introduction'::"text", 'background'::"text", 'related_work'::"text", 'methods'::"text", 'results'::"text", 'discussion'::"text", 'conclusion'::"text", 'limitations'::"text", 'references'::"text", 'acknowledgments'::"text", 'appendix'::"text", 'other'::"text"]))),
    CONSTRAINT "paper_sections_title_check" CHECK ((("char_length"(TRIM(BOTH FROM "title")) >= 1) AND ("char_length"(TRIM(BOTH FROM "title")) <= 300)))
);


ALTER TABLE "public"."paper_sections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."research_projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "research_projects_description_check" CHECK ((("description" IS NULL) OR ("char_length"("description") <= 2000))),
    CONSTRAINT "research_projects_title_check" CHECK ((("char_length"(TRIM(BOTH FROM "title")) >= 1) AND ("char_length"(TRIM(BOTH FROM "title")) <= 200)))
);


ALTER TABLE "public"."research_projects" OWNER TO "postgres";


ALTER TABLE ONLY "public"."chunk_embeddings"
    ADD CONSTRAINT "chunk_embeddings_pkey" PRIMARY KEY ("chunk_id", "model_id");



ALTER TABLE ONLY "public"."embedding_models"
    ADD CONSTRAINT "embedding_models_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."embedding_models"
    ADD CONSTRAINT "embedding_models_provider_provider_model_dimensions_input_p_key" UNIQUE ("provider", "provider_model", "dimensions", "input_profile");



ALTER TABLE ONLY "public"."paper_chunks"
    ADD CONSTRAINT "paper_chunks_id_paper_user_key" UNIQUE ("id", "paper_id", "user_id");



ALTER TABLE ONLY "public"."paper_chunks"
    ADD CONSTRAINT "paper_chunks_paper_id_chunk_index_key" UNIQUE ("paper_id", "chunk_index");



ALTER TABLE ONLY "public"."paper_chunks"
    ADD CONSTRAINT "paper_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."paper_embedding_jobs"
    ADD CONSTRAINT "paper_embedding_jobs_pkey" PRIMARY KEY ("paper_id", "model_id");



ALTER TABLE ONLY "public"."paper_extraction_fields"
    ADD CONSTRAINT "paper_extraction_fields_paper_id_schema_version_field_key_u_key" UNIQUE ("paper_id", "schema_version", "field_key", "user_id");



ALTER TABLE ONLY "public"."paper_extraction_fields"
    ADD CONSTRAINT "paper_extraction_fields_pkey" PRIMARY KEY ("paper_id", "schema_version", "field_key");



ALTER TABLE ONLY "public"."paper_extraction_sources"
    ADD CONSTRAINT "paper_extraction_sources_pkey" PRIMARY KEY ("paper_id", "schema_version", "field_key", "item_index", "ord");



ALTER TABLE ONLY "public"."paper_extractions"
    ADD CONSTRAINT "paper_extractions_paper_id_schema_version_user_id_key" UNIQUE ("paper_id", "schema_version", "user_id");



ALTER TABLE ONLY "public"."paper_extractions"
    ADD CONSTRAINT "paper_extractions_pkey" PRIMARY KEY ("paper_id", "schema_version");



ALTER TABLE ONLY "public"."paper_project_links"
    ADD CONSTRAINT "paper_project_links_pkey" PRIMARY KEY ("paper_id", "project_id");



ALTER TABLE ONLY "public"."paper_sections"
    ADD CONSTRAINT "paper_sections_id_paper_id_key" UNIQUE ("id", "paper_id");



ALTER TABLE ONLY "public"."paper_sections"
    ADD CONSTRAINT "paper_sections_paper_id_position_key" UNIQUE ("paper_id", "position");



ALTER TABLE ONLY "public"."paper_sections"
    ADD CONSTRAINT "paper_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."papers"
    ADD CONSTRAINT "papers_id_user_id_key" UNIQUE ("id", "user_id");



ALTER TABLE ONLY "public"."papers"
    ADD CONSTRAINT "papers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."research_projects"
    ADD CONSTRAINT "research_projects_id_user_id_key" UNIQUE ("id", "user_id");



ALTER TABLE ONLY "public"."research_projects"
    ADD CONSTRAINT "research_projects_pkey" PRIMARY KEY ("id");



CREATE INDEX "chunk_embeddings_model_idx" ON "public"."chunk_embeddings" USING "btree" ("model_id");



CREATE INDEX "chunk_embeddings_paper_model_idx" ON "public"."chunk_embeddings" USING "btree" ("paper_id", "model_id");



CREATE INDEX "chunk_embeddings_user_model_idx" ON "public"."chunk_embeddings" USING "btree" ("user_id", "model_id");



CREATE UNIQUE INDEX "embedding_models_single_active_idx" ON "public"."embedding_models" USING "btree" ((true)) WHERE ("status" = 'active'::"text");



CREATE INDEX "paper_chunks_section_idx" ON "public"."paper_chunks" USING "btree" ("section_id");



CREATE INDEX "paper_chunks_user_idx" ON "public"."paper_chunks" USING "btree" ("user_id");



CREATE INDEX "paper_embedding_jobs_model_status_idx" ON "public"."paper_embedding_jobs" USING "btree" ("model_id", "status");



CREATE INDEX "paper_embedding_jobs_user_idx" ON "public"."paper_embedding_jobs" USING "btree" ("user_id");



CREATE INDEX "paper_extraction_sources_chunk_idx" ON "public"."paper_extraction_sources" USING "btree" ("chunk_id");



CREATE INDEX "paper_extraction_sources_section_idx" ON "public"."paper_extraction_sources" USING "btree" ("section_id");



CREATE INDEX "paper_extractions_open_idx" ON "public"."paper_extractions" USING "btree" ("schema_version", "updated_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'running'::"text"]));



CREATE INDEX "paper_extractions_user_idx" ON "public"."paper_extractions" USING "btree" ("user_id");



CREATE INDEX "paper_project_links_project_idx" ON "public"."paper_project_links" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "paper_project_links_user_idx" ON "public"."paper_project_links" USING "btree" ("user_id");



CREATE INDEX "paper_sections_user_idx" ON "public"."paper_sections" USING "btree" ("user_id");



CREATE INDEX "papers_pending_processing_idx" ON "public"."papers" USING "btree" ("created_at") WHERE ("status" = ANY (ARRAY['uploaded'::"text", 'processing'::"text"]));



CREATE UNIQUE INDEX "papers_storage_path_key" ON "public"."papers" USING "btree" ("storage_path") WHERE ("storage_path" IS NOT NULL);



CREATE UNIQUE INDEX "papers_user_content_hash_key" ON "public"."papers" USING "btree" ("user_id", "content_hash") WHERE ("content_hash" IS NOT NULL);



CREATE INDEX "papers_user_created_idx" ON "public"."papers" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "research_projects_user_updated_idx" ON "public"."research_projects" USING "btree" ("user_id", "updated_at" DESC);



CREATE OR REPLACE TRIGGER "embedding_models_protect_identity" BEFORE UPDATE ON "public"."embedding_models" FOR EACH ROW EXECUTE FUNCTION "public"."embedding_models_protect_identity"();



CREATE OR REPLACE TRIGGER "embedding_models_updated_at" BEFORE UPDATE ON "public"."embedding_models" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "paper_embedding_jobs_updated_at" BEFORE UPDATE ON "public"."paper_embedding_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "paper_extraction_fields_updated_at" BEFORE UPDATE ON "public"."paper_extraction_fields" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "paper_extractions_updated_at" BEFORE UPDATE ON "public"."paper_extractions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "papers_updated_at" BEFORE UPDATE ON "public"."papers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "research_projects_updated_at" BEFORE UPDATE ON "public"."research_projects" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."chunk_embeddings"
    ADD CONSTRAINT "chunk_embeddings_chunk_id_paper_id_user_id_fkey" FOREIGN KEY ("chunk_id", "paper_id", "user_id") REFERENCES "public"."paper_chunks"("id", "paper_id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chunk_embeddings"
    ADD CONSTRAINT "chunk_embeddings_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "public"."embedding_models"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."paper_chunks"
    ADD CONSTRAINT "paper_chunks_paper_id_user_id_fkey" FOREIGN KEY ("paper_id", "user_id") REFERENCES "public"."papers"("id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paper_chunks"
    ADD CONSTRAINT "paper_chunks_section_id_paper_id_fkey" FOREIGN KEY ("section_id", "paper_id") REFERENCES "public"."paper_sections"("id", "paper_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paper_chunks"
    ADD CONSTRAINT "paper_chunks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paper_embedding_jobs"
    ADD CONSTRAINT "paper_embedding_jobs_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "public"."embedding_models"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."paper_embedding_jobs"
    ADD CONSTRAINT "paper_embedding_jobs_paper_id_user_id_fkey" FOREIGN KEY ("paper_id", "user_id") REFERENCES "public"."papers"("id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paper_extraction_fields"
    ADD CONSTRAINT "paper_extraction_fields_paper_id_schema_version_user_id_fkey" FOREIGN KEY ("paper_id", "schema_version", "user_id") REFERENCES "public"."paper_extractions"("paper_id", "schema_version", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paper_extraction_sources"
    ADD CONSTRAINT "paper_extraction_sources_chunk_id_paper_id_user_id_fkey" FOREIGN KEY ("chunk_id", "paper_id", "user_id") REFERENCES "public"."paper_chunks"("id", "paper_id", "user_id") ON DELETE SET NULL ("chunk_id");



ALTER TABLE ONLY "public"."paper_extraction_sources"
    ADD CONSTRAINT "paper_extraction_sources_paper_id_schema_version_field_key_fkey" FOREIGN KEY ("paper_id", "schema_version", "field_key", "user_id") REFERENCES "public"."paper_extraction_fields"("paper_id", "schema_version", "field_key", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paper_extraction_sources"
    ADD CONSTRAINT "paper_extraction_sources_section_id_paper_id_fkey" FOREIGN KEY ("section_id", "paper_id") REFERENCES "public"."paper_sections"("id", "paper_id") ON DELETE SET NULL ("section_id");



ALTER TABLE ONLY "public"."paper_extractions"
    ADD CONSTRAINT "paper_extractions_paper_id_user_id_fkey" FOREIGN KEY ("paper_id", "user_id") REFERENCES "public"."papers"("id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paper_project_links"
    ADD CONSTRAINT "paper_project_links_paper_id_user_id_fkey" FOREIGN KEY ("paper_id", "user_id") REFERENCES "public"."papers"("id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paper_project_links"
    ADD CONSTRAINT "paper_project_links_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "public"."research_projects"("id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paper_project_links"
    ADD CONSTRAINT "paper_project_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paper_sections"
    ADD CONSTRAINT "paper_sections_paper_id_user_id_fkey" FOREIGN KEY ("paper_id", "user_id") REFERENCES "public"."papers"("id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paper_sections"
    ADD CONSTRAINT "paper_sections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."papers"
    ADD CONSTRAINT "papers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."research_projects"
    ADD CONSTRAINT "research_projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Signed-in users read embedding models" ON "public"."embedding_models" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users create own paper links" ON "public"."paper_project_links" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users delete own paper links" ON "public"."paper_project_links" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users manage own papers" ON "public"."papers" TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users manage own projects" ON "public"."research_projects" TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users read own embedding job status" ON "public"."paper_embedding_jobs" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users read own extraction fields" ON "public"."paper_extraction_fields" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users read own extraction sources" ON "public"."paper_extraction_sources" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users read own extractions" ON "public"."paper_extractions" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users read own paper chunks" ON "public"."paper_chunks" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users read own paper links" ON "public"."paper_project_links" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users read own paper sections" ON "public"."paper_sections" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users read own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Users update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."chunk_embeddings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."embedding_models" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."paper_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."paper_embedding_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."paper_extraction_fields" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."paper_extraction_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."paper_extractions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."paper_project_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."paper_sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."papers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."research_projects" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_next_embedding_job"("p_paper_id" "uuid", "p_max_attempts" integer, "p_stale_after" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_next_embedding_job"("p_paper_id" "uuid", "p_max_attempts" integer, "p_stale_after" interval) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_next_paper"("p_max_attempts" integer, "p_stale_after" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_next_paper"("p_max_attempts" integer, "p_stale_after" interval) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_next_paper_extraction"("p_schema_version" integer, "p_max_attempts" integer, "p_stale_after" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_next_paper_extraction"("p_schema_version" integer, "p_max_attempts" integer, "p_stale_after" interval) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_stale_after" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_stale_after" interval) TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_embedding_job"("p_paper_id" "uuid", "p_model_id" "text", "p_claim_started_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_embedding_job"("p_paper_id" "uuid", "p_model_id" "text", "p_claim_started_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone, "p_provider" "text", "p_model" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone, "p_provider" "text", "p_model" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_paper_processing"("p_paper_id" "uuid", "p_started_at" timestamp with time zone, "p_page_count" integer, "p_sections" "jsonb", "p_chunks" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_paper_processing"("p_paper_id" "uuid", "p_started_at" timestamp with time zone, "p_page_count" integer, "p_sections" "jsonb", "p_chunks" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."embedding_models_protect_identity"() TO "anon";
GRANT ALL ON FUNCTION "public"."embedding_models_protect_identity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."embedding_models_protect_identity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_embedding_job"("p_paper_id" "uuid", "p_model_id" "text", "p_claim_started_at" timestamp with time zone, "p_error" "text", "p_retry" boolean, "p_count_attempt" boolean, "p_retry_delay" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_embedding_job"("p_paper_id" "uuid", "p_model_id" "text", "p_claim_started_at" timestamp with time zone, "p_error" "text", "p_retry" boolean, "p_count_attempt" boolean, "p_retry_delay" interval) TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone, "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone, "p_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_paper_processing"("p_paper_id" "uuid", "p_started_at" timestamp with time zone, "p_error" "text", "p_retry" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_paper_processing"("p_paper_id" "uuid", "p_started_at" timestamp with time zone, "p_error" "text", "p_retry" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_search_coverage"("p_paper_ids" "uuid"[], "p_project_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_search_coverage"("p_paper_ids" "uuid"[], "p_project_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_paper_extraction"("p_paper_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_paper_extraction"("p_paper_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."request_paper_extraction"("p_paper_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."retry_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."retry_paper_extraction"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_paper_chunks"("p_query_embedding" "jsonb", "p_expected_model_id" "text", "p_paper_ids" "uuid"[], "p_project_id" "uuid", "p_limit" integer, "p_min_similarity" double precision, "p_include_references" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_paper_chunks"("p_query_embedding" "jsonb", "p_expected_model_id" "text", "p_paper_ids" "uuid"[], "p_project_id" "uuid", "p_limit" integer, "p_min_similarity" double precision, "p_include_references" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."search_scope_paper_ids"("p_paper_ids" "uuid"[], "p_project_id" "uuid") FROM PUBLIC;



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."store_chunk_embeddings"("p_paper_id" "uuid", "p_model_id" "text", "p_claim_started_at" timestamp with time zone, "p_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."store_chunk_embeddings"("p_paper_id" "uuid", "p_model_id" "text", "p_claim_started_at" timestamp with time zone, "p_rows" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."store_extraction_field"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone, "p_field_key" "text", "p_state" "text", "p_value" "jsonb", "p_sources" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."store_extraction_field"("p_paper_id" "uuid", "p_schema_version" integer, "p_claim_started_at" timestamp with time zone, "p_field_key" "text", "p_state" "text", "p_value" "jsonb", "p_sources" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."chunk_embeddings" TO "service_role";



GRANT ALL ON TABLE "public"."embedding_models" TO "service_role";
GRANT SELECT ON TABLE "public"."embedding_models" TO "authenticated";



GRANT ALL ON TABLE "public"."paper_chunks" TO "service_role";
GRANT SELECT ON TABLE "public"."paper_chunks" TO "authenticated";



GRANT ALL ON TABLE "public"."paper_embedding_jobs" TO "service_role";



GRANT SELECT("paper_id") ON TABLE "public"."paper_embedding_jobs" TO "authenticated";



GRANT SELECT("model_id") ON TABLE "public"."paper_embedding_jobs" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."paper_embedding_jobs" TO "authenticated";



GRANT SELECT("source_completed_at") ON TABLE "public"."paper_embedding_jobs" TO "authenticated";



GRANT SELECT("completed_at") ON TABLE "public"."paper_embedding_jobs" TO "authenticated";



GRANT SELECT("chunk_count") ON TABLE "public"."paper_embedding_jobs" TO "authenticated";



GRANT SELECT("embedded_count") ON TABLE "public"."paper_embedding_jobs" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."paper_embedding_jobs" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."paper_embedding_jobs" TO "authenticated";



GRANT ALL ON TABLE "public"."paper_extraction_fields" TO "service_role";



GRANT SELECT("paper_id") ON TABLE "public"."paper_extraction_fields" TO "authenticated";



GRANT SELECT("schema_version") ON TABLE "public"."paper_extraction_fields" TO "authenticated";



GRANT SELECT("field_key") ON TABLE "public"."paper_extraction_fields" TO "authenticated";



GRANT SELECT("state") ON TABLE "public"."paper_extraction_fields" TO "authenticated";



GRANT SELECT("value") ON TABLE "public"."paper_extraction_fields" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."paper_extraction_fields" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."paper_extraction_fields" TO "authenticated";



GRANT ALL ON TABLE "public"."paper_extractions" TO "service_role";



GRANT SELECT("paper_id") ON TABLE "public"."paper_extractions" TO "authenticated";



GRANT SELECT("schema_version") ON TABLE "public"."paper_extractions" TO "authenticated";



GRANT SELECT("source_completed_at") ON TABLE "public"."paper_extractions" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."paper_extractions" TO "authenticated";



GRANT SELECT("provider") ON TABLE "public"."paper_extractions" TO "authenticated";



GRANT SELECT("model") ON TABLE "public"."paper_extractions" TO "authenticated";



GRANT SELECT("completed_at") ON TABLE "public"."paper_extractions" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."paper_extractions" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."paper_extractions" TO "authenticated";



GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."papers" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."papers" TO "authenticated";
GRANT ALL ON TABLE "public"."papers" TO "service_role";



GRANT INSERT("id") ON TABLE "public"."papers" TO "authenticated";



GRANT INSERT("user_id") ON TABLE "public"."papers" TO "authenticated";



GRANT INSERT("title"),UPDATE("title") ON TABLE "public"."papers" TO "authenticated";



GRANT INSERT("authors"),UPDATE("authors") ON TABLE "public"."papers" TO "authenticated";



GRANT INSERT("publication_year"),UPDATE("publication_year") ON TABLE "public"."papers" TO "authenticated";



GRANT INSERT("storage_path") ON TABLE "public"."papers" TO "authenticated";



GRANT INSERT("file_size_bytes") ON TABLE "public"."papers" TO "authenticated";



GRANT INSERT("original_filename") ON TABLE "public"."papers" TO "authenticated";



GRANT INSERT("mime_type") ON TABLE "public"."papers" TO "authenticated";



GRANT INSERT("content_hash") ON TABLE "public"."papers" TO "authenticated";



GRANT UPDATE("citation_title") ON TABLE "public"."papers" TO "authenticated";



GRANT UPDATE("citation_container_title") ON TABLE "public"."papers" TO "authenticated";



GRANT UPDATE("citation_publisher") ON TABLE "public"."papers" TO "authenticated";



GRANT UPDATE("citation_doi") ON TABLE "public"."papers" TO "authenticated";



GRANT UPDATE("citation_url") ON TABLE "public"."papers" TO "authenticated";



GRANT UPDATE("citation_volume") ON TABLE "public"."papers" TO "authenticated";



GRANT UPDATE("citation_issue") ON TABLE "public"."papers" TO "authenticated";



GRANT UPDATE("citation_pages") ON TABLE "public"."papers" TO "authenticated";



GRANT ALL ON TABLE "public"."paper_extraction_overview" TO "service_role";
GRANT SELECT ON TABLE "public"."paper_extraction_overview" TO "authenticated";



GRANT ALL ON TABLE "public"."paper_extraction_sources" TO "service_role";



GRANT SELECT("paper_id") ON TABLE "public"."paper_extraction_sources" TO "authenticated";



GRANT SELECT("schema_version") ON TABLE "public"."paper_extraction_sources" TO "authenticated";



GRANT SELECT("field_key") ON TABLE "public"."paper_extraction_sources" TO "authenticated";



GRANT SELECT("item_index") ON TABLE "public"."paper_extraction_sources" TO "authenticated";



GRANT SELECT("ord") ON TABLE "public"."paper_extraction_sources" TO "authenticated";



GRANT SELECT("chunk_id") ON TABLE "public"."paper_extraction_sources" TO "authenticated";



GRANT SELECT("section_id") ON TABLE "public"."paper_extraction_sources" TO "authenticated";



GRANT SELECT("section_title") ON TABLE "public"."paper_extraction_sources" TO "authenticated";



GRANT SELECT("section_type") ON TABLE "public"."paper_extraction_sources" TO "authenticated";



GRANT SELECT("page_start") ON TABLE "public"."paper_extraction_sources" TO "authenticated";



GRANT SELECT("page_end") ON TABLE "public"."paper_extraction_sources" TO "authenticated";



GRANT SELECT("excerpt") ON TABLE "public"."paper_extraction_sources" TO "authenticated";



GRANT ALL ON TABLE "public"."paper_project_links" TO "anon";
GRANT ALL ON TABLE "public"."paper_project_links" TO "authenticated";
GRANT ALL ON TABLE "public"."paper_project_links" TO "service_role";



GRANT ALL ON TABLE "public"."paper_sections" TO "service_role";
GRANT SELECT ON TABLE "public"."paper_sections" TO "authenticated";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."research_projects" TO "anon";
GRANT ALL ON TABLE "public"."research_projects" TO "authenticated";
GRANT ALL ON TABLE "public"."research_projects" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







