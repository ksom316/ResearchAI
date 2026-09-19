import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from './api'
import type { ProjectInput } from './api'
import { paperKeys } from '#/features/papers/queries'

export const projectKeys = {
  all: ['projects'] as const,
  list: (limit?: number) => ['projects', 'list', limit ?? 'all'] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
}

export const projectsQuery = (limit?: number) =>
  queryOptions({
    queryKey: projectKeys.list(limit),
    queryFn: () => listProjects(limit),
  })

export const projectQuery = (id: string) =>
  queryOptions({
    queryKey: projectKeys.detail(id),
    queryFn: () => getProject(id),
  })

const errorToast = (error: Error) => toast.error(error.message)

export function useCreateProject(onSuccess?: (id: string) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ProjectInput) => createProject(input),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.all })
      toast.success('Project created')
      onSuccess?.(project.id)
    },
    onError: errorToast,
  })
}

export function useUpdateProject(id: string, onSuccess?: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ProjectInput) => updateProject(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: projectKeys.all })
      toast.success('Project updated')
      onSuccess?.()
    },
    onError: errorToast,
  })
}

export function useDeleteProject(id: string, onSuccess?: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => deleteProject(id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: projectKeys.detail(id) })
      await queryClient.invalidateQueries({ queryKey: projectKeys.all })
      await queryClient.invalidateQueries({ queryKey: paperKeys.all })
      toast.success('Project deleted')
      onSuccess?.()
    },
    onError: errorToast,
  })
}
