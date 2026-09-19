-- ResearchAI Phase 2: PDF ingestion metadata.
-- Additive only; 0001_foundation.sql is untouched. Run in the Supabase SQL editor.

alter table public.papers
  add column if not exists original_filename text
    check (original_filename is null or char_length(original_filename) <= 255),
  add column if not exists mime_type text
    check (mime_type is null or char_length(mime_type) <= 100);

-- The stored object must live at {user_id}/{paper_id}/<filename>. This prevents a
-- row from ever pointing at another user's (or another paper's) storage object.
alter table public.papers
  add constraint papers_storage_path_owner_check
  check (
    storage_path is null
    or storage_path like (user_id::text || '/' || id::text || '/%')
  );

-- Each paper owns exactly one object.
create unique index if not exists papers_storage_path_key
  on public.papers (storage_path) where storage_path is not null;
