import { createServerFn } from '@tanstack/react-start'
import { embedSearchQuery } from '#/features/search/query-embedder.server'
import { createSupabaseSearchDb } from '#/features/search/search-db'
import { runSemanticSearch } from '#/features/search/search-service'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import type { WriterEvidenceResult } from './types'
import { createSupabaseWriterDb } from './writer-db.server'
import { prepareWriterEvidence } from './writer-service'

/** Authenticated server boundary for deterministic Writer evidence preparation. */
export const prepareWriterEvidenceFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<WriterEvidenceResult> => {
    const supabase = createSupabaseServerClient()
    return prepareWriterEvidence(data, {
      db: createSupabaseWriterDb(supabase),
      semanticSearch: (request) =>
        runSemanticSearch(request, {
          db: createSupabaseSearchDb(supabase),
          embedQuery: (query) => embedSearchQuery(query),
        }),
    })
  })
