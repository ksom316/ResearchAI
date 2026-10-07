import { describe, expect, it, vi } from 'vitest'
import {
  subscribeToNotifications,
  subscribeToProjectCollaboration,
} from './realtime'
import type { RealtimeChannelLike, RealtimeClient } from './realtime'

function fakeClient() {
  const handlers: { table: string; filter: string; callback: () => void }[] = []
  const channel: RealtimeChannelLike = {
    on: vi.fn((_event, filter, callback) => {
      handlers.push({ table: filter.table, filter: filter.filter, callback })
      return channel
    }),
    subscribe: vi.fn(() => channel),
  }
  const removeChannel = vi.fn()
  const client: RealtimeClient = {
    channel: vi.fn(() => channel),
    removeChannel,
  }
  return { client, channel, handlers, removeChannel }
}

describe('subscribeToProjectCollaboration', () => {
  it('subscribes one topic scoped to the project, filtered per table', () => {
    const { client, channel, handlers } = fakeClient()
    subscribeToProjectCollaboration(client, 'proj-1', () => {})
    expect(client.channel).toHaveBeenCalledWith('collaboration:proj-1')
    expect(channel.subscribe).toHaveBeenCalledTimes(1)
    expect(handlers.map((h) => h.table).sort()).toEqual(
      ['assignments', 'comments', 'discussions', 'notes', 'project_activity'].sort(),
    )
    for (const h of handlers) expect(h.filter).toBe('project_id=eq.proj-1')
  })

  it('routes an event to the callback with the table it came from', () => {
    const { client, handlers } = fakeClient()
    const onChange = vi.fn()
    subscribeToProjectCollaboration(client, 'proj-1', onChange)
    const commentsHandler = handlers.find((h) => h.table === 'comments')!
    commentsHandler.callback()
    expect(onChange).toHaveBeenCalledWith('comments')
  })

  it('cleanup removes exactly the channel it created', () => {
    const { client, channel, removeChannel } = fakeClient()
    const unsubscribe = subscribeToProjectCollaboration(client, 'proj-1', () => {})
    expect(removeChannel).not.toHaveBeenCalled()
    unsubscribe()
    expect(removeChannel).toHaveBeenCalledWith(channel)
    expect(removeChannel).toHaveBeenCalledTimes(1)
  })

  it('project switching uses a distinct topic per project (no cross-project leak)', () => {
    const { client } = fakeClient()
    subscribeToProjectCollaboration(client, 'proj-1', () => {})
    subscribeToProjectCollaboration(client, 'proj-2', () => {})
    expect(client.channel).toHaveBeenNthCalledWith(1, 'collaboration:proj-1')
    expect(client.channel).toHaveBeenNthCalledWith(2, 'collaboration:proj-2')
  })
})

describe('subscribeToNotifications', () => {
  it('filters strictly by recipient, not project', () => {
    const { client, handlers } = fakeClient()
    subscribeToNotifications(client, 'user-1', () => {})
    expect(client.channel).toHaveBeenCalledWith('notifications:user-1')
    expect(handlers).toHaveLength(1)
    expect(handlers[0].filter).toBe('recipient_id=eq.user-1')
  })

  it('cleanup removes the channel exactly once', () => {
    const { client, channel, removeChannel } = fakeClient()
    const unsubscribe = subscribeToNotifications(client, 'user-1', () => {})
    unsubscribe()
    unsubscribe() // idempotent: a double-unmount must not double-remove or throw
    expect(removeChannel).toHaveBeenCalledWith(channel)
  })
})
