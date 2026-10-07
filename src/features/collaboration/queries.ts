import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  addComment,
  createDiscussion,
  deleteComment,
  editComment,
  listDiscussionComments,
  listPaperDiscussions,
  listProjectDiscussions,
  reopenDiscussion,
  resolveDiscussion,
} from './discussions-api'
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications-api'
import {
  createAssignment,
  listMyAssignments,
  listProjectAssignments,
  updateAssignmentStatus,
} from './assignments-api'
import { NoteConflictError, createNote, getNote, listProjectNotes, updateNote } from './notes-api'
import type { AssignmentStatus, TargetRef } from './types'

export const collaborationKeys = {
  all: ['collaboration'] as const,
  discussions: (paperId: string) => ['collaboration', 'discussions', paperId] as const,
  projectDiscussions: (projectId: string) => ['collaboration', 'discussions', 'project', projectId] as const,
  comments: (discussionId: string) => ['collaboration', 'comments', discussionId] as const,
  notifications: () => ['collaboration', 'notifications'] as const,
  unreadCount: () => ['collaboration', 'notifications', 'unread-count'] as const,
  projectAssignments: (projectId: string) => ['collaboration', 'assignments', 'project', projectId] as const,
  myAssignments: (userId: string) => ['collaboration', 'assignments', 'mine', userId] as const,
  notes: (projectId: string) => ['collaboration', 'notes', projectId] as const,
  note: (noteId: string) => ['collaboration', 'note', noteId] as const,
}

export const paperDiscussionsQuery = (paperId: string) =>
  queryOptions({
    queryKey: collaborationKeys.discussions(paperId),
    queryFn: () => listPaperDiscussions(paperId),
  })

export const projectDiscussionsQuery = (projectId: string) =>
  queryOptions({
    queryKey: collaborationKeys.projectDiscussions(projectId),
    queryFn: () => listProjectDiscussions(projectId),
  })

export const discussionCommentsQuery = (discussionId: string) =>
  queryOptions({
    queryKey: collaborationKeys.comments(discussionId),
    queryFn: () => listDiscussionComments(discussionId),
  })

export const notificationsQuery = () =>
  queryOptions({
    queryKey: collaborationKeys.notifications(),
    queryFn: () => listNotifications(),
  })

export const unreadNotificationCountQuery = () =>
  queryOptions({
    queryKey: collaborationKeys.unreadCount(),
    queryFn: () => countUnreadNotifications(),
  })

export const projectAssignmentsQuery = (projectId: string) =>
  queryOptions({
    queryKey: collaborationKeys.projectAssignments(projectId),
    queryFn: () => listProjectAssignments(projectId),
  })

export const myAssignmentsQuery = (userId: string) =>
  queryOptions({
    queryKey: collaborationKeys.myAssignments(userId),
    queryFn: () => listMyAssignments(userId),
  })

export const projectNotesQuery = (projectId: string) =>
  queryOptions({
    queryKey: collaborationKeys.notes(projectId),
    queryFn: () => listProjectNotes(projectId),
  })

export const noteQuery = (noteId: string) =>
  queryOptions({
    queryKey: collaborationKeys.note(noteId),
    queryFn: () => getNote(noteId),
  })

function invalidateDiscussion(
  queryClient: ReturnType<typeof useQueryClient>,
  paperId: string,
  discussionId?: string,
) {
  const tasks = [queryClient.invalidateQueries({ queryKey: collaborationKeys.discussions(paperId) })]
  if (discussionId) {
    tasks.push(queryClient.invalidateQueries({ queryKey: collaborationKeys.comments(discussionId) }))
  }
  return Promise.all(tasks)
}

export function useCreateDiscussion(paperId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { projectId: string; target: TargetRef; body: string; mentionedUserIds: string[] }) =>
      createDiscussion(input),
    onSuccess: async () => {
      await invalidateDiscussion(queryClient, paperId)
      toast.success('Discussion started')
    },
    onError: () => toast.error('Could not start the discussion'),
  })
}

export function useAddComment(paperId: string, discussionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { body: string; mentionedUserIds: string[] }) =>
      addComment({ discussionId, ...input }),
    onSuccess: async () => {
      await invalidateDiscussion(queryClient, paperId, discussionId)
    },
    onError: () => toast.error('Could not post the comment'),
  })
}

export function useEditComment(paperId: string, discussionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { commentId: string; body: string }) => editComment(input.commentId, input.body),
    onSuccess: async () => {
      await invalidateDiscussion(queryClient, paperId, discussionId)
    },
    onError: () => toast.error('Could not save the edit'),
  })
}

export function useDeleteComment(paperId: string, discussionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => deleteComment(commentId),
    onSuccess: async () => {
      await invalidateDiscussion(queryClient, paperId, discussionId)
    },
    onError: () => toast.error('Could not delete the comment'),
  })
}

export function useResolveDiscussion(paperId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (discussionId: string) => resolveDiscussion(discussionId),
    onSuccess: async (_data, discussionId) => {
      await invalidateDiscussion(queryClient, paperId, discussionId)
      toast.success('Discussion resolved')
    },
    onError: () => toast.error('Could not resolve the discussion'),
  })
}

export function useReopenDiscussion(paperId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (discussionId: string) => reopenDiscussion(discussionId),
    onSuccess: async (_data, discussionId) => {
      await invalidateDiscussion(queryClient, paperId, discussionId)
      toast.success('Discussion reopened')
    },
    onError: () => toast.error('Could not reopen the discussion'),
  })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (notificationId: string) => markNotificationRead(notificationId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: collaborationKeys.notifications() }),
        queryClient.invalidateQueries({ queryKey: collaborationKeys.unreadCount() }),
      ])
    },
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: collaborationKeys.notifications() }),
        queryClient.invalidateQueries({ queryKey: collaborationKeys.unreadCount() }),
      ])
    },
  })
}

export function useCreateAssignment(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof createAssignment>[0]) => createAssignment(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: collaborationKeys.projectAssignments(projectId) })
      toast.success('Assignment created')
    },
    onError: () => toast.error('Could not create the assignment'),
  })
}

export function useUpdateAssignmentStatus(projectId: string, userId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { assignmentId: string; status: AssignmentStatus }) =>
      updateAssignmentStatus(input.assignmentId, input.status),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: collaborationKeys.projectAssignments(projectId) }),
        queryClient.invalidateQueries({ queryKey: collaborationKeys.myAssignments(userId) }),
      ])
    },
    onError: () => toast.error('Could not update the assignment'),
  })
}

export function useCreateNote(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { title: string; content?: string }) => createNote({ projectId, ...input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: collaborationKeys.notes(projectId) })
      toast.success('Note created')
    },
    onError: () => toast.error('Could not create the note'),
  })
}

export function useUpdateNote(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { noteId: string; title: string; content: string; expectedRevision: number }) =>
      updateNote(input),
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: collaborationKeys.notes(projectId) }),
        queryClient.invalidateQueries({ queryKey: collaborationKeys.note(input.noteId) }),
      ])
    },
    onError: (error) => {
      toast.error(error instanceof NoteConflictError ? error.message : 'Could not save the note')
    },
  })
}
