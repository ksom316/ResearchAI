-- R12: Universal Document Intelligence foundation.
-- Additive to 0001-0022 (untouched): existing papers, sections and chunks
-- keep working exactly as before. This adds:
--   - document_type / extraction_quality on papers (deterministic, no AI cost)
--   - paper_pages:  per-page profile (char density, likely-scanned, OCR state)
--   - paper_tables: detected tables, kept as a header + row grid
--   - paper_facts:  structured facts (financial metrics etc.) with provenance
--   - paper_chunks.source_kind: lets table/fact text flow through the EXISTING
--     embedding worker and search_paper_chunks RPC unchanged, so Research Chat
--     can retrieve a table or a financial metric the same way it retrieves prose.
-- All new/derived data is written only by the service role, same as sections/
-- chunks; clients may only read their own (or shared, via can_view_paper).
begin;

-- Classification + extraction quality on papers --------------------------------
alter table public.papers
  add column document_type text
    check (document_type is null or document_type in (
      'academic', 'financial', 'annual_report', 'government', 'policy',
      'technical', 'market_research', 'thesis', 'case_study', 'survey',
      'general_report', 'unknown'
    )),
  add column document_type_confidence numeric
    check (document_type_confidence is null
           or (document_type_confidence >= 0 and document_type_confidence <= 1)),
  add column document_type_method text
    check (document_type_method is null or document_type_method in ('deterministic', 'llm')),
  add column extraction_quality text
    check (extraction_quality is null or extraction_quality in (
      'successful', 'partial', 'poor', 'no_extractable_text', 'ocr_required'
    ));

-- Pages --------------------------------------------------------------------------
create table public.paper_pages (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  page_number int not null check (page_number >= 1),
  char_count int not null check (char_count >= 0),
  likely_scanned boolean not null default false,
  -- OCR is architecture-ready but not wired to a live provider in this change
  -- (see R12 report): 'required' pages sit here until a provider is
  -- configured. No credentials are invented or assumed.
  ocr_status text not null default 'not_required'
    check (ocr_status in ('not_required', 'required', 'pending', 'completed', 'failed')),
  ocr_text text,
  ocr_confidence numeric check (ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 1)),
  ocr_attempts int not null default 0 check (ocr_attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (paper_id, page_number),
  foreign key (paper_id, user_id)
    references public.papers (id, user_id) on delete cascade
);

create index paper_pages_user_idx on public.paper_pages (user_id);
-- Lets a future OCR worker cheaply find pages still needing OCR.
create index paper_pages_ocr_pending_idx
  on public.paper_pages (paper_id)
  where ocr_status = 'required';

-- Tables ---------------------------------------------------------------------------
create table public.paper_tables (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  table_index int not null check (table_index >= 0),
  page_start int not null check (page_start >= 1),
  page_end int not null check (page_end >= page_start),
  caption text check (caption is null or char_length(caption) <= 300),
  -- Kept as a grid, not flattened to prose, so row/column/cell structure
  -- survives for anything that wants it (see types.ts DetectedTable).
  headers jsonb not null default '[]'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  unique (paper_id, table_index),
  unique (id, paper_id),  -- lets chunks/facts prove their table belongs to the same paper
  foreign key (paper_id, user_id)
    references public.papers (id, user_id) on delete cascade
);

create index paper_tables_user_idx on public.paper_tables (user_id);

-- Structured facts -----------------------------------------------------------------
create table public.paper_facts (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  metric text not null check (char_length(metric) <= 100),
  value double precision,
  unit text check (unit is null or char_length(unit) <= 30),
  currency text check (currency is null or char_length(currency) <= 10),
  period text check (period is null or char_length(period) <= 50),
  raw_text text not null check (char_length(raw_text) <= 300),
  page_number int check (page_number is null or page_number >= 1),
  table_id uuid,
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  foreign key (paper_id, user_id)
    references public.papers (id, user_id) on delete cascade,
  -- A fact's table, if any, must belong to the same paper.
  foreign key (table_id, paper_id)
    references public.paper_tables (id, paper_id) on delete cascade
);

create index paper_facts_user_idx on public.paper_facts (user_id);
create index paper_facts_metric_idx on public.paper_facts (paper_id, metric);

-- Chunks: distinguish prose from synthetic table/fact chunks ------------------------
alter table public.paper_chunks
  add column source_kind text not null default 'text'
    check (source_kind in ('text', 'table', 'fact')),
  add column source_table_id uuid;

alter table public.paper_chunks
  add constraint paper_chunks_source_table_fk
  foreign key (source_table_id, paper_id)
  references public.paper_tables (id, paper_id) on delete cascade;

-- RLS: clients may only READ, same collaborator rule as sections/chunks (R10) ------
alter table public.paper_pages enable row level security;
alter table public.paper_tables enable row level security;
alter table public.paper_facts enable row level security;

create policy "Members read paper pages" on public.paper_pages
  for select to authenticated using (public.can_view_paper(paper_id));
create policy "Members read paper tables" on public.paper_tables
  for select to authenticated using (public.can_view_paper(paper_id));
create policy "Members read paper facts" on public.paper_facts
  for select to authenticated using (public.can_view_paper(paper_id));

revoke all on public.paper_pages, public.paper_tables, public.paper_facts from anon, authenticated;
grant select on public.paper_pages, public.paper_tables, public.paper_facts to authenticated;
grant select, insert, update, delete
  on public.paper_pages, public.paper_tables, public.paper_facts to service_role;

-- Extend the processing-completion RPC (additive, backward-compatible) -------------
-- New params default to empty/null so a caller using the old 5-arg signature
-- (if one somehow still exists) continues to work; the worker always passes
-- all of them. Still one transaction, still fenced by p_started_at, still
-- idempotent on retry (old derived rows for every R12 table are cleared first).
create or replace function public.complete_paper_processing(
  p_paper_id uuid,
  p_started_at timestamptz,
  p_page_count int,
  p_sections jsonb,
  p_chunks jsonb,
  p_pages jsonb default '[]'::jsonb,
  p_tables jsonb default '[]'::jsonb,
  p_facts jsonb default '[]'::jsonb,
  p_document_type text default null,
  p_document_type_confidence numeric default null,
  p_document_type_method text default null,
  p_extraction_quality text default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
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

  -- Idempotent on retry: old derived rows go first (chunks/tables/facts cascade).
  delete from public.paper_sections s where s.paper_id = p_paper_id;
  delete from public.paper_pages pg where pg.paper_id = p_paper_id;
  delete from public.paper_tables t where t.paper_id = p_paper_id;
  -- paper_facts has no direct paper_id-only cascade source other than papers
  -- itself, so it is deleted explicitly too (its table_id FK cascades from
  -- paper_tables, but a fact sourced from prose has no table_id).
  delete from public.paper_facts f where f.paper_id = p_paper_id;

  insert into public.paper_sections
    (id, paper_id, user_id, "position", title, section_type, page_start, page_end, text)
  select x.id, p_paper_id, v_user_id, x."position", x.title, x.section_type,
         x.page_start, x.page_end, x.text
    from jsonb_to_recordset(coalesce(p_sections, '[]'::jsonb)) as x(
      id uuid, "position" int, title text, section_type text,
      page_start int, page_end int, text text
    );

  insert into public.paper_tables
    (id, paper_id, user_id, table_index, page_start, page_end, caption, headers, rows, confidence)
  select x.id, p_paper_id, v_user_id, x.table_index, x.page_start, x.page_end,
         x.caption, coalesce(x.headers, '[]'::jsonb), coalesce(x.rows, '[]'::jsonb), x.confidence
    from jsonb_to_recordset(coalesce(p_tables, '[]'::jsonb)) as x(
      id uuid, table_index int, page_start int, page_end int,
      caption text, headers jsonb, rows jsonb, confidence numeric
    );

  insert into public.paper_chunks
    (id, paper_id, user_id, section_id, chunk_index, text,
     char_start, char_end, page_start, page_end, source_kind, source_table_id)
  select x.id, p_paper_id, v_user_id, x.section_id, x.chunk_index, x.text,
         x.char_start, x.char_end, x.page_start, x.page_end,
         coalesce(x.source_kind, 'text'), x.source_table_id
    from jsonb_to_recordset(coalesce(p_chunks, '[]'::jsonb)) as x(
      id uuid, section_id uuid, chunk_index int, text text,
      char_start int, char_end int, page_start int, page_end int,
      source_kind text, source_table_id uuid
    );

  insert into public.paper_pages
    (paper_id, user_id, page_number, char_count, likely_scanned, ocr_status)
  select p_paper_id, v_user_id, x.page_number, x.char_count, x.likely_scanned,
         coalesce(x.ocr_status, 'not_required')
    from jsonb_to_recordset(coalesce(p_pages, '[]'::jsonb)) as x(
      page_number int, char_count int, likely_scanned boolean, ocr_status text
    );

  insert into public.paper_facts
    (id, paper_id, user_id, metric, value, unit, currency, period,
     raw_text, page_number, table_id, confidence)
  select x.id, p_paper_id, v_user_id, x.metric, x.value, x.unit, x.currency, x.period,
         x.raw_text, x.page_number, x.table_id, x.confidence
    from jsonb_to_recordset(coalesce(p_facts, '[]'::jsonb)) as x(
      id uuid, metric text, value double precision, unit text, currency text,
      period text, raw_text text, page_number int, table_id uuid, confidence numeric
    );

  update public.papers p
     set status = 'ready',
         processing_completed_at = now(),
         processing_error = null,
         page_count = p_page_count,
         document_type = p_document_type,
         document_type_confidence = p_document_type_confidence,
         document_type_method = p_document_type_method,
         extraction_quality = p_extraction_quality
   where p.id = p_paper_id;

  return true;
end;
$$;

-- Fail: also clear R12 derived rows and optionally stamp extraction_quality -------
create or replace function public.fail_paper_processing(
  p_paper_id uuid,
  p_started_at timestamptz,
  p_error text,
  p_retry boolean,
  p_extraction_quality text default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
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
  delete from public.paper_pages pg where pg.paper_id = p_paper_id;
  delete from public.paper_tables t where t.paper_id = p_paper_id;
  delete from public.paper_facts f where f.paper_id = p_paper_id;

  if p_retry then
    update public.papers p
       set status = 'uploaded',
           processing_started_at = null,
           processing_completed_at = null,
           processing_error = null,
           extraction_quality = null
     where p.id = p_paper_id;
  else
    update public.papers p
       set status = 'failed',
           processing_completed_at = now(),
           processing_error = coalesce(left(p_error, 1000), 'Processing failed.'),
           extraction_quality = p_extraction_quality
     where p.id = p_paper_id;
  end if;

  return true;
end;
$$;

revoke all on function public.complete_paper_processing(
  uuid, timestamptz, int, jsonb, jsonb, jsonb, jsonb, jsonb, text, numeric, text, text
) from public, anon, authenticated;
revoke all on function public.fail_paper_processing(uuid, timestamptz, text, boolean, text)
  from public, anon, authenticated;

grant execute on function public.complete_paper_processing(
  uuid, timestamptz, int, jsonb, jsonb, jsonb, jsonb, jsonb, text, numeric, text, text
) to service_role;
grant execute on function public.fail_paper_processing(uuid, timestamptz, text, boolean, text)
  to service_role;

-- The old 5-arg complete_paper_processing and 4-arg fail_paper_processing
-- overloads are superseded; drop them so the worker cannot accidentally call
-- a stale signature that skips R12 columns.
drop function if exists public.complete_paper_processing(uuid, timestamptz, int, jsonb, jsonb);
drop function if exists public.fail_paper_processing(uuid, timestamptz, text, boolean);

commit;
