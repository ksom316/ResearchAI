import { createServerFn } from '@tanstack/react-start'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { embedSearchQuery } from './query-embedder.server'
import { createSupabaseSearchDb } from './search-db'
import { runSearchCoverage, runSemanticSearch } from './search-service'
import type { SearchCoverageOutcome, SearchOutcome } from './types'

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

/** Authenticated coverage-only inspection; never embeds a query or searches chunks. */
export const searchCoverageFn = createServerFn({ method: 'GET' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<SearchCoverageOutcome> =>
    runSearchCoverage(
      data,
      createSupabaseSearchDb(createSupabaseServerClient()),
    ),
  )
