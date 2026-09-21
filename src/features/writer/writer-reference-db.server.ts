import { z } from 'zod'
import { paperRowToCitationMetadata } from '#/features/papers/citation-metadata'
import type { PaperCitationMetadata } from '#/features/citations/types'
import type { createSupabaseServerClient } from '#/lib/supabase/supabase.server'

type SupabaseLike = ReturnType<typeof createSupabaseServerClient>

export const WRITER_REFERENCE_COLUMNS =
  'id, title, authors, publication_year, citation_title, citation_container_title, citation_publisher, citation_doi, citation_url, citation_volume, citation_issue, citation_pages'

const citationRow = z.object({
  id: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  publication_year: z.number().nullable(),
  citation_title: z.string().nullable(),
  citation_container_title: z.string().nullable(),
  citation_publisher: z.string().nullable(),
  citation_doi: z.string().nullable(),
  citation_url: z.string().nullable(),
  citation_volume: z.string().nullable(),
  citation_issue: z.string().nullable(),
  citation_pages: z.string().nullable(),
})

/** Request-scoped, RLS-authorized citation metadata for already-cited papers. */
export async function loadWriterReferenceMetadata(
  supabase: SupabaseLike,
  paperIds: readonly string[],
): Promise<PaperCitationMetadata[]> {
  const ids = [...new Set(paperIds)]
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('papers')
    .select(WRITER_REFERENCE_COLUMNS)
    .in('id', ids)
  if (error) throw new Error('Writer reference metadata is unavailable')
  return (Array.isArray(data) ? data : []).flatMap((row) => {
    const parsed = citationRow.safeParse(row)
    return parsed.success ? [paperRowToCitationMetadata(parsed.data)] : []
  })
}
