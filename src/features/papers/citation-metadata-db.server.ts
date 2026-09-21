import { z } from 'zod'
import type { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import type { CitationMetadataDb } from './citation-metadata-service'

type SupabaseLike = ReturnType<typeof createSupabaseServerClient>

export const CITATION_METADATA_PAPER_COLUMNS =
  'id, title, authors, publication_year, citation_title, citation_container_title, citation_publisher, citation_doi, citation_url, citation_volume, citation_issue, citation_pages'

const paperRow = z.object({
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

/** Cookie-authenticated, RLS-scoped citation metadata writes only. */
export function createSupabaseCitationMetadataDb(
  supabase: SupabaseLike,
): CitationMetadataDb {
  return {
    getUserId: async () =>
      (await supabase.auth.getUser()).data.user?.id ?? null,
    updateCitationMetadata: async (paperId, columns) => {
      const { data, error } = await supabase
        .from('papers')
        .update(columns)
        .eq('id', paperId)
        .select(CITATION_METADATA_PAPER_COLUMNS)
        .maybeSingle()
      if (error) throw new Error('Citation metadata is unavailable')
      if (data === null) return null
      const parsed = paperRow.safeParse(data)
      if (!parsed.success) throw new Error('Citation metadata is unavailable')
      return parsed.data
    },
  }
}
