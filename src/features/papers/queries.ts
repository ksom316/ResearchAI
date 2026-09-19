import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  deletePaper,
  getLibraryStats,
  getPaper,
  getPaperUrl,
  linkPaperToProject,
  listPaperSections,
  listPapers,
  unlinkPaperFromProject,
  uploadPaper,
} from './api'
import { isInProgress } from './status'
import type { Paper } from './types'

export const paperKeys = {
  all: ['papers'] as const,
  list: (projectId?: string, limit?: number) =>
    ['papers', 'list', projectId ?? 'all', limit ?? 'all'] as const,
  stats: ['papers', 'stats'] as const,
  detail: (id: string) => ['papers', 'detail', id] as const,
  sections: (id: string) => ['papers', 'sections', id] as const,
}

/** Polling interval while papers are waiting for / undergoing processing. */
const PROCESSING_REFRESH_MS = 10_000

export const papersQuery = (options?: { projectId?: string; limit?: number }) =>
  queryOptions({
    queryKey: paperKeys.list(options?.projectId, options?.limit),
    queryFn: () => listPapers(options),
    refetchInterval: (query) =>
      query.state.data?.some((p) => isInProgress(p.status))
        ? PROCESSING_REFRESH_MS
        : false,
  })

export const paperQuery = (id: string) =>
  queryOptions({
    queryKey: paperKeys.detail(id),
    queryFn: () => getPaper(id),
    refetchInterval: (query) =>
      query.state.data && isInProgress(query.state.data.status)
        ? PROCESSING_REFRESH_MS
        : false,
  })

export const paperSectionsQuery = (id: string) =>
  queryOptions({
    queryKey: paperKeys.sections(id),
    queryFn: () => listPaperSections(id),
  })

export const libraryStatsQuery = queryOptions({
  queryKey: paperKeys.stats,
  queryFn: getLibraryStats,
})

const errorToast = (error: Error) => toast.error(error.message)

export function useUploadPaper() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: uploadPaper,
    onSettled: () => queryClient.invalidateQueries({ queryKey: paperKeys.all }),
  })
}

export function useLinkPaper() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { paperId: string; projectId: string }) =>
      linkPaperToProject(v.paperId, v.projectId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: paperKeys.all })
      toast.success('Paper added to project')
    },
    onError: errorToast,
  })
}

export function useUnlinkPaper() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (v: { paperId: string; projectId: string }) =>
      unlinkPaperFromProject(v.paperId, v.projectId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: paperKeys.all })
      toast.success('Paper removed from project')
    },
    onError: errorToast,
  })
}

export function useDeletePaper(
  onSuccess?: () => void,
  options?: {
    /**
     * Runs right after the delete succeeds and BEFORE the caches are refreshed.
     * A view of the deleted paper should leave here (awaited), so it is no longer
     * mounted when the refresh runs and never renders a "not found" state.
     */
    onDeleted?: () => void | Promise<unknown>
  },
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (paper: Paper) => deletePaper(paper),
    onSuccess: async (_data, paper) => {
      try {
        await options?.onDeleted?.()
      } catch {
        // Failing to navigate must not be reported as a failed delete.
      }
      queryClient.removeQueries({ queryKey: paperKeys.detail(paper.id) })
      queryClient.removeQueries({ queryKey: paperKeys.sections(paper.id) })
      await queryClient.invalidateQueries({ queryKey: paperKeys.all })
      toast.success('Paper deleted')
      onSuccess?.()
    },
    // The record may or may not still exist after a partial failure; refresh.
    onError: async (error) => {
      toast.error(error.message)
      await queryClient.invalidateQueries({ queryKey: paperKeys.all })
    },
  })
}

/** Opens the PDF in a new tab through a short-lived signed URL. */
export function useOpenPaper() {
  return useMutation({
    mutationFn: async (paper: Paper) => {
      // Open synchronously so popup blockers allow it, then navigate.
      const win = window.open('', '_blank')
      try {
        const url = await getPaperUrl(paper)
        if (win) {
          win.opener = null
          win.location.href = url
        } else {
          window.location.href = url
        }
      } catch (e) {
        win?.close()
        throw e
      }
    },
    onError: errorToast,
  })
}
