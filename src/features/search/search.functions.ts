import { createServerFn } from '@tanstack/react-start'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { embedSearchQuery } from './query-embedder.server'
import { createSupabaseSearchDb } from './search-db'
import { runSemanticSearch } from './search-service'
import type { SearchOutcome } from './types'

/**
 * Explicit, authenticated semantic search (never called on keystroke). Input is
 * validated inside the service and answered as a result union, not thrown.
 */
export const semanticSearchFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<SearchOutcome> =>
    runSemanticSearch(data, {
      db: createSupabaseSearchDb(createSupabaseServerClient()),
      embedQuery: (query) => embedSearchQuery(query),
    }),
  )
