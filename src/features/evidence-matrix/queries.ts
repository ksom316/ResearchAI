import {
  queryOptions,
  skipToken,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  listExtractionFields,
  listExtractionOverviews,
  listExtractionSources,
  normalizePaperIds,
  requestPaperExtraction,
} from './api'
import {
  hasActiveExtraction,
  REQUEST_ERROR_MESSAGE,
  REQUEST_MESSAGES,
} from './status'
import type { ClaimSelection, FieldKey } from './types'

/**
 * Keys use the SORTED, de-duplicated paper ids, so the same set of papers is one cache
 * entry whatever order the list arrived in.
 */
export const evidenceKeys = {
  all: ['evidence-matrix'] as const,
  overviews: ['evidence-matrix', 'overview'] as const,
  overview: (paperIds: readonly string[]) =>
    ['evidence-matrix', 'overview', normalizePaperIds(paperIds)] as const,
  fieldsAll: ['evidence-matrix', 'fields'] as const,
  fields: (paperIds: readonly string[]) =>
    ['evidence-matrix', 'fields', normalizePaperIds(paperIds)] as const,
  sources: (paperId: string, fieldKey: FieldKey) =>
    ['evidence-matrix', 'sources', paperId, fieldKey] as const,
}

/** Same cadence as paper processing. */
export const EXTRACTION_REFRESH_MS = 10_000

/** Polls itself only while one of its own rows is pending or running. */
export const extractionOverviewsQuery = (paperIds: readonly string[]) =>
  queryOptions({
    queryKey: evidenceKeys.overview(paperIds),
    queryFn: () => listExtractionOverviews(paperIds),
    refetchInterval: (query) =>
      hasActiveExtraction(query.state.data) ? EXTRACTION_REFRESH_MS : false,
  })

/**
 * The fields query cannot see the overview, so the caller passes `poll` (typically
 * hasActiveExtraction(overviews)). It never polls by itself.
 */
export const extractionFieldsQuery = (
  paperIds: readonly string[],
  options?: { poll?: boolean },
) =>
  queryOptions({
    queryKey: evidenceKeys.fields(paperIds),
    queryFn: () => listExtractionFields(paperIds),
    refetchInterval: options?.poll ? EXTRACTION_REFRESH_MS : false,
  })

/** Provenance for one field of one paper; load it only when the claim is opened. */
export const extractionSourcesQuery = (paperId: string, fieldKey: FieldKey) =>
  queryOptions({
    queryKey: evidenceKeys.sources(paperId, fieldKey),
    queryFn: () => listExtractionSources(paperId, fieldKey),
  })

/**
 * Sources for the claim sheet. With no selection the query is DISABLED (no fetch, no
 * request is built); with one it is exactly extractionSourcesQuery for that paper + field.
 */
export const extractionSourcesForSelection = (selection: ClaimSelection | null) =>
  queryOptions({
    queryKey: selection
      ? evidenceKeys.sources(selection.paperId, selection.fieldKey)
      : (['evidence-matrix', 'sources', 'none'] as const),
    queryFn: selection
      ? () => listExtractionSources(selection.paperId, selection.fieldKey)
      : skipToken,
    enabled: selection !== null,
  })

/**
 * Requests extraction for one paper. Only ever called from an explicit user action;
 * nothing here runs on page load. Refreshes the overview and field queries afterwards.
 */
export function useRequestExtraction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (paperId: string) => requestPaperExtraction(paperId),
    onSuccess: async (result) => {
      const { tone, message } = REQUEST_MESSAGES[result]
      if (tone === 'success') toast.success(message)
      else if (tone === 'error') toast.error(message)
      else toast.info(message)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: evidenceKeys.overviews }),
        queryClient.invalidateQueries({ queryKey: evidenceKeys.fieldsAll }),
      ])
    },
    onError: () => toast.error(REQUEST_ERROR_MESSAGE),
  })
}
