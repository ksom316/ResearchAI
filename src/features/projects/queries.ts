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
import {
  changeProjectMemberRole,
  getProjectRole,
  inviteProjectMember,
  listProjectActivity,
  listProjectMembers,
  removeProjectMember,
} from './collaboration'
import type { ProjectRole } from './collaboration'

export const projectKeys = {
  all: ['projects'] as const,
  list: (limit?: number) => ['projects', 'list', limit ?? 'all'] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
  role: (id: string) => ['projects', 'role', id] as const,
  members: (id: string) => ['projects', 'members', id] as const,
  activity: (id: string) => ['projects', 'activity', id] as const,
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

export const projectRoleQuery = (id: string) => queryOptions({ queryKey: projectKeys.role(id), queryFn: () => getProjectRole(id) })
export const projectMembersQuery = (id: string) => queryOptions({ queryKey: projectKeys.members(id), queryFn: () => listProjectMembers(id) })
export const projectActivityQuery = (id: string) => queryOptions({ queryKey: projectKeys.activity(id), queryFn: () => listProjectActivity(id) })

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

export function useInviteProjectMember(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { email: string; role: Exclude<ProjectRole, 'OWNER'> }) => inviteProjectMember({ projectId, ...input }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) }); toast.success('Invitation created') },
    onError: errorToast,
  })
}

export function useChangeProjectMemberRole(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { userId: string; role: Exclude<ProjectRole, 'OWNER'> }) => changeProjectMemberRole(projectId, input.userId, input.role),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) }), queryClient.invalidateQueries({ queryKey: projectKeys.activity(projectId) })]); toast.success('Role updated') },
    onError: errorToast,
  })
}

export function useRemoveProjectMember(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => removeProjectMember(projectId, userId),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: projectKeys.members(projectId) }), queryClient.invalidateQueries({ queryKey: projectKeys.activity(projectId) })]); toast.success('Member removed') },
    onError: errorToast,
  })
}
