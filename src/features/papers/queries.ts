import { queryOptions } from '@tanstack/react-query'
import { getLibraryStats, listPapers } from './api'

export const paperKeys = {
  all: ['papers'] as const,
  list: (projectId?: string, limit?: number) =>
    ['papers', 'list', projectId ?? 'all', limit ?? 'all'] as const,
  stats: ['papers', 'stats'] as const,
}

export const papersQuery = (options?: { projectId?: string; limit?: number }) =>
  queryOptions({
    queryKey: paperKeys.list(options?.projectId, options?.limit),
    queryFn: () => listPapers(options),
  })

export const libraryStatsQuery = queryOptions({
  queryKey: paperKeys.stats,
  queryFn: getLibraryStats,
})
