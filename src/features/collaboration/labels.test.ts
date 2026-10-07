import { describe, expect, it } from 'vitest'
import { formatActivityMessage, formatNotificationMessage } from './labels'

describe('formatActivityMessage', () => {
  it('describes a paper comment', () => {
    expect(
      formatActivityMessage({ eventType: 'comment_created', actorName: 'John', metadata: {} }),
    ).toBe('John commented on a paper.')
  })

  it('describes an evidence-item comment', () => {
    expect(
      formatActivityMessage({
        eventType: 'comment_created',
        actorName: 'John',
        metadata: { target_type: 'evidence_item' },
      }),
    ).toBe('John commented on an evidence item.')
  })

  it('describes resolve/reopen', () => {
    expect(formatActivityMessage({ eventType: 'discussion_resolved', actorName: 'Jane', metadata: {} })).toBe(
      'Jane resolved a discussion.',
    )
    expect(formatActivityMessage({ eventType: 'discussion_reopened', actorName: 'Jane', metadata: {} })).toBe(
      'Jane reopened a discussion.',
    )
  })

  it('includes a note title when available', () => {
    expect(
      formatActivityMessage({
        eventType: 'note_created',
        actorName: 'Alex',
        metadata: { title: 'Lit review plan' },
      }),
    ).toBe('Alex added the note "Lit review plan".')
  })

  it('falls back to a generic subject when the actor is unknown', () => {
    expect(formatActivityMessage({ eventType: 'assignment_completed', actorName: null, metadata: {} })).toBe(
      'Someone completed an assignment.',
    )
  })

  it('falls back to a generic message for an unrecognized event type', () => {
    expect(formatActivityMessage({ eventType: 'paper_added', actorName: 'John', metadata: {} })).toBe(
      'John made a change.',
    )
  })
})

describe('formatNotificationMessage', () => {
  it('matches the spec examples', () => {
    expect(formatNotificationMessage({ eventType: 'mention', actorName: 'John' })).toBe(
      'John mentioned you in a discussion.',
    )
    expect(formatNotificationMessage({ eventType: 'reply', actorName: 'Sarah' })).toBe(
      'Sarah replied to your discussion.',
    )
    expect(formatNotificationMessage({ eventType: 'assignment_created', actorName: 'Someone' })).toBe(
      'Someone assigned you a research task.',
    )
    expect(formatNotificationMessage({ eventType: 'discussion_reopened', actorName: 'Michael' })).toBe(
      'Michael reopened a discussion you resolved.',
    )
  })
})
