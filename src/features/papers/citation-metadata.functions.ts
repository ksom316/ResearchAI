import { createServerFn } from '@tanstack/react-start'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { createSupabaseCitationMetadataDb } from './citation-metadata-db.server'
import { updateCitationMetadata } from './citation-metadata-service'
import type { CitationMetadataUpdateResult } from './citation-metadata-service'

export const updateCitationMetadataFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<CitationMetadataUpdateResult> => {
    const supabase = createSupabaseServerClient()
    return updateCitationMetadata(data, {
      db: createSupabaseCitationMetadataDb(supabase),
    })
  })
