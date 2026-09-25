import { createServerFn } from '@tanstack/react-start'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { embedSearchQuery } from './query-embedder.server'
import { createSupabaseSearchDb } from './search-db'
import { runSearchCoverage, runSemanticSearch } from './search-service'
import type { SearchCoverageOutcome, SearchOutcome } from './types'
import { searchRequestSchema } from './schemas'
import { createBestEffortServerUsageRecorder } from '#/lib/usage/recorder.server'
import { requireProjectViewer } from '#/lib/projects/authorization.server'
import { logSemanticSearchDiagnostic } from './diagnostics.server'

/**
 * Explicit, authenticated semantic search (never called on keystroke). Input is
 * validated inside the service and answered as a result union, not thrown.
 */
export const semanticSearchFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<SearchOutcome> => {
    const supabase = createSupabaseServerClient()
    const actorUserId = (await supabase.auth.getUser()).data.user?.id ?? null
    const parsed = searchRequestSchema.safeParse(data)
    const projectId =
      parsed.success && parsed.data.scope.type === 'project'
        ? parsed.data.scope.projectId
        : null
    if (projectId) await requireProjectViewer(supabase, projectId)
    const recordUsage = createBestEffortServerUsageRecorder()
    return runSemanticSearch(data, {
      db: createSupabaseSearchDb(supabase),
      embedQuery: (query) =>
        actorUserId
          ? embedSearchQuery(query, {
              actorUserId,
              projectId,
              feature: 'semantic_search',
              recordUsage,
            })
          : embedSearchQuery(query),
      diagnostic: logSemanticSearchDiagnostic,
    })
  })

/** Authenticated coverage-only inspection; never embeds a query or searches chunks. */
export const searchCoverageFn = createServerFn({ method: 'GET' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<SearchCoverageOutcome> => {
    const supabase = createSupabaseServerClient()
    return runSearchCoverage(data, createSupabaseSearchDb(supabase))
  })
