import { describe, expect, it, vi } from 'vitest'
import { joinPresence } from './presence'
import type { PresenceChannelLike, PresenceClient } from './presence'

function fakeClient(initialState: Record<string, { userId: string; name: string | null }[]> = {}) {
  let syncCallback: (() => void) | null = null
  let state = initialState
  const tracked: Record<string, unknown>[] = []
  const channel: PresenceChannelLike = {
    on: vi.fn((_event, _filter, callback) => {
      syncCallback = callback
      return channel
    }),
    subscribe: vi.fn((callback) => {
      callback?.('SUBSCRIBED')
      return channel
    }),
    track: vi.fn(async (trackState) => {
      tracked.push(trackState)
      return { status: 'ok' }
    }),
    presenceState: () => state,
  }
  const removeChannel = vi.fn()
  const client: PresenceClient = {
    channel: vi.fn(() => channel),
    removeChannel,
  }
  return {
    client,
    channel,
    removeChannel,
    tracked,
    fireSync: (next: typeof state) => {
      state = next
      syncCallback?.()
    },
  }
}

describe('joinPresence', () => {
  it('joins a private, project-scoped topic', () => {
    const { client } = fakeClient()
    joinPresence(client, { userId: 'u1', name: 'Jane' }, { projectId: 'proj-1' }, () => {})
    expect(client.channel).toHaveBeenCalledWith('presence:project:proj-1', {
      config: { presence: { key: 'u1' }, private: true },
    })
  })

  it('scopes to project+paper when a paperId is given', () => {
    const { client } = fakeClient()
    joinPresence(client, { userId: 'u1', name: 'Jane' }, { projectId: 'proj-1', paperId: 'paper-9' }, () => {})
    expect(client.channel).toHaveBeenCalledWith(
      'presence:project:proj-1:paper:paper-9',
      expect.anything(),
    )
  })

  it('tracks the current user once subscribed', () => {
    const { client, tracked } = fakeClient()
    joinPresence(client, { userId: 'u1', name: 'Jane' }, { projectId: 'proj-1' }, () => {})
    expect(tracked).toEqual([{ userId: 'u1', name: 'Jane' }])
  })

  it('reports a deduplicated, flattened list of everyone present on sync', () => {
    const { client, fireSync } = fakeClient()
    const onChange = vi.fn()
    joinPresence(client, { userId: 'u1', name: 'Jane' }, { projectId: 'proj-1' }, onChange)
    fireSync({
      u1: [{ userId: 'u1', name: 'Jane' }],
      u2: [{ userId: 'u2', name: 'Bob' }, { userId: 'u2', name: 'Bob' }],
    })
    expect(onChange).toHaveBeenCalledWith([
      { userId: 'u1', name: 'Jane' },
      { userId: 'u2', name: 'Bob' },
    ])
  })

  it('reports an empty list once everyone has left', () => {
    const { client, fireSync } = fakeClient({ u1: [{ userId: 'u1', name: 'Jane' }] })
    const onChange = vi.fn()
    joinPresence(client, { userId: 'u1', name: 'Jane' }, { projectId: 'proj-1' }, onChange)
    fireSync({})
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('cleanup leaves the channel (so others stop seeing this viewer)', () => {
    const { client, channel, removeChannel } = fakeClient()
    const leave = joinPresence(client, { userId: 'u1', name: 'Jane' }, { projectId: 'proj-1' }, () => {})
    expect(removeChannel).not.toHaveBeenCalled()
    leave()
    expect(removeChannel).toHaveBeenCalledWith(channel)
  })
})
