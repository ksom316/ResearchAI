-- ResearchAI Phase 7C.3: user-maintained bibliographic metadata.
-- These fields are citation-only and do not participate in PDF processing,
-- chunking, embeddings, Evidence Matrix generations, or provenance identity.
begin;

alter table public.papers
  add column citation_title text
    check (citation_title is null or char_length(trim(citation_title)) between 1 and 500),
  add column citation_container_title text
    check (citation_container_title is null or char_length(trim(citation_container_title)) between 1 and 500),
  add column citation_publisher text
    check (citation_publisher is null or char_length(trim(citation_publisher)) between 1 and 300),
  add column citation_doi text
    check (
      citation_doi is null
      or (
        char_length(citation_doi) <= 255
        and citation_doi ~* '^10\.[0-9]{4,9}/[-._;()/:+A-Z0-9]+$'
      )
    ),
  add column citation_url text
    check (
      citation_url is null
      or (
        char_length(citation_url) <= 2048
        and citation_url ~* '^https?://[^[:space:]]+$'
      )
    ),
  add column citation_volume text
    check (citation_volume is null or char_length(trim(citation_volume)) between 1 and 50),
  add column citation_issue text
    check (citation_issue is null or char_length(trim(citation_issue)) between 1 and 50),
  add column citation_pages text
    check (citation_pages is null or char_length(trim(citation_pages)) between 1 and 100);

grant update (
  authors,
  publication_year,
  citation_title,
  citation_container_title,
  citation_publisher,
  citation_doi,
  citation_url,
  citation_volume,
  citation_issue,
  citation_pages
) on public.papers to authenticated;

commit;
