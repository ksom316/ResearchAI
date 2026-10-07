import { describe, expect, it } from 'vitest'
import {
  canComment,
  canCreateAssignment,
  canEditNote,
  canModifyComment,
  canResolveDiscussion,
  canUpdateAssignmentStatus,
} from './permissions'

describe('canComment', () => {
  it('allows any member, including a viewer', () => {
    expect(canComment('VIEWER')).toBe(true)
    expect(canComment('EDITOR')).toBe(true)
    expect(canComment('OWNER')).toBe(true)
  })
  it('denies a non-member', () => {
    expect(canComment(null)).toBe(false)
  })
})

describe('canResolveDiscussion / canCreateAssignment / canEditNote', () => {
  it('allow editors and owners', () => {
    for (const fn of [canResolveDiscussion, canCreateAssignment, canEditNote]) {
      expect(fn('OWNER')).toBe(true)
      expect(fn('EDITOR')).toBe(true)
    }
  })
  it('deny a viewer and a non-member', () => {
    for (const fn of [canResolveDiscussion, canCreateAssignment, canEditNote]) {
      expect(fn('VIEWER')).toBe(false)
      expect(fn(null)).toBe(false)
    }
  })
})

describe('canUpdateAssignmentStatus', () => {
  const assignment = { assigneeId: 'u1', assignerId: 'u2' }
  it('allows the assignee', () => {
    expect(canUpdateAssignmentStatus('VIEWER', 'u1', assignment)).toBe(true)
  })
  it('allows the assigner', () => {
    expect(canUpdateAssignmentStatus('EDITOR', 'u2', assignment)).toBe(true)
  })
  it('denies a bystander editor', () => {
    expect(canUpdateAssignmentStatus('EDITOR', 'u3', assignment)).toBe(false)
  })
  it('denies a non-member even if their id matches', () => {
    expect(canUpdateAssignmentStatus(null, 'u1', assignment)).toBe(false)
  })
})

describe('canModifyComment', () => {
  it('allows only the author', () => {
    expect(canModifyComment('u1', 'u1')).toBe(true)
    expect(canModifyComment('u1', 'u2')).toBe(false)
  })
})
