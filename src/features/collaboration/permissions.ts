import type { ProjectRole } from '#/features/projects/collaboration'

/**
 * Client-side mirror of the R13 database authorization rules (migration
 * 0024), used only to decide what UI to show - never the source of truth.
 * Every RPC re-checks can_view_project/can_edit_project itself, so a stale or
 * spoofed client value here can hide a button at worst, never bypass a check.
 */

/** Any project member (including VIEWER) may read and post comments. */
export function canComment(role: ProjectRole | null): boolean {
  return role !== null
}

const EDIT_ROLES: ReadonlySet<ProjectRole> = new Set(['OWNER', 'EDITOR'])

/** Resolving/reopening a discussion requires edit access, same as can_edit_project. */
export function canResolveDiscussion(role: ProjectRole | null): boolean {
  return role !== null && EDIT_ROLES.has(role)
}

/** Creating an assignment requires edit access (the assigner must be an editor/owner). */
export function canCreateAssignment(role: ProjectRole | null): boolean {
  return role !== null && EDIT_ROLES.has(role)
}

/** Either party to an assignment (assignee or assigner) may change its status. */
export function canUpdateAssignmentStatus(
  role: ProjectRole | null,
  userId: string,
  assignment: { assigneeId: string; assignerId: string },
): boolean {
  return (
    role !== null &&
    (userId === assignment.assigneeId || userId === assignment.assignerId)
  )
}

/** Creating/editing a research note requires edit access. */
export function canEditNote(role: ProjectRole | null): boolean {
  return role !== null && EDIT_ROLES.has(role)
}

/** A comment may be edited or deleted only by its own author. */
export function canModifyComment(userId: string, authorId: string): boolean {
  return userId === authorId
}
