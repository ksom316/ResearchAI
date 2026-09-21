import { queryOptions } from '@tanstack/react-query'
import { searchCoverageFn } from '#/features/search/search.functions'

export const qualityInspectorKeys = {
  coverage: (projectId: string) =>
    ['quality-inspector', 'coverage', projectId] as const,
}

export const qualityWorkspaceCoverageQuery = (projectId: string) =>
  queryOptions({
    queryKey: qualityInspectorKeys.coverage(projectId),
    queryFn: async () => {
      const result = await searchCoverageFn({ data: { projectId } })
      if (!result.ok) throw new Error('Research quality data is unavailable.')
      return result.coverage
    },
  })
