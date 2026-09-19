import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  deletePaper,
  getLibraryStats,
  getPaperUrl,
  linkPaperToProject,
  listPapers,
  unlinkPaperFromProject,
  uploadPaper,
} from './api'
import type { Paper } from './types'

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

export function useDeletePaper(onSuccess?: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (paper: Paper) => deletePaper(paper),
    onSuccess: async () => {
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
