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

  // Same class of bug as the notifications regression below: two workspace
  // tabs for the same project (e.g. Notes and Discussions) can both be
  // mounted at once, each calling subscribeToProjectCollaboration for the
  // same project id.
  it('two components subscribing to the same project share one channel', () => {
    const { client, channel } = fakeClient()
    subscribeToProjectCollaboration(client, 'proj-1', () => {})
    subscribeToProjectCollaboration(client, 'proj-1', () => {})
    expect(client.channel).toHaveBeenCalledTimes(1)
    expect(channel.subscribe).toHaveBeenCalledTimes(1)
  })

  it('only removes the shared project channel once every subscriber has left', () => {
    const { client, channel, removeChannel } = fakeClient()
    const leaveA = subscribeToProjectCollaboration(client, 'proj-1', () => {})
    const leaveB = subscribeToProjectCollaboration(client, 'proj-1', () => {})
    leaveA()
    expect(removeChannel).not.toHaveBeenCalled()
    leaveB()
    expect(removeChannel).toHaveBeenCalledWith(channel)
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

  // Regression for a production incident: AppShell always mounts the desktop
  // sidebar's NotificationBell (merely CSS-hidden on mobile, not unmounted),
  // and mounts a second NotificationBell inside the mobile drawer once the
  // hamburger button opens it - so the same `notifications:<userId>` topic
  // gets subscribed to twice while the app is running. supabase-js's
  // realtime-js returns the SAME channel instance for a repeated topic, and
  // throws if `.on()` is called on it again after `.subscribe()`. This must
  // never call `client.channel`/`.on`/`.subscribe` more than once per topic.
  it('a second subscriber for the same topic (e.g. the mobile drawer opening) does not resubscribe the channel', () => {
    const { client, channel } = fakeClient()
    const first = vi.fn()
    const second = vi.fn()

    subscribeToNotifications(client, 'user-1', first)
    expect(client.channel).toHaveBeenCalledTimes(1)
    expect(channel.on).toHaveBeenCalledTimes(1)
    expect(channel.subscribe).toHaveBeenCalledTimes(1)

    // The hamburger opens: a second NotificationBell mounts for the same user.
    subscribeToNotifications(client, 'user-1', second)
    expect(client.channel).toHaveBeenCalledTimes(1) // not called again
    expect(channel.on).toHaveBeenCalledTimes(1) // never re-registered post-subscribe
    expect(channel.subscribe).toHaveBeenCalledTimes(1)
  })

  it('delivers one incoming event to every subscriber sharing the topic', () => {
    const { client, handlers } = fakeClient()
    const first = vi.fn()
    const second = vi.fn()
    subscribeToNotifications(client, 'user-1', first)
    subscribeToNotifications(client, 'user-1', second)

    handlers[0].callback()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('closing the mobile drawer (one of two subscribers leaving) keeps the channel alive for the other', () => {
    const { client, channel, removeChannel, handlers } = fakeClient()
    const desktopBell = vi.fn()
    const mobileBell = vi.fn()
    const leaveDesktop = subscribeToNotifications(client, 'user-1', desktopBell)
    const leaveMobile = subscribeToNotifications(client, 'user-1', mobileBell)

    leaveMobile() // drawer closes
    expect(removeChannel).not.toHaveBeenCalled()

    handlers[0].callback()
    expect(desktopBell).toHaveBeenCalledTimes(1)
    expect(mobileBell).not.toHaveBeenCalled()

    leaveDesktop() // last subscriber leaves
    expect(removeChannel).toHaveBeenCalledWith(channel)
    expect(removeChannel).toHaveBeenCalledTimes(1)
  })

  it('reopening the drawer repeatedly never calls subscribe more than once while a subscriber remains', () => {
    const { client, channel } = fakeClient()
    const desktopBell = vi.fn()
    subscribeToNotifications(client, 'user-1', desktopBell)

    for (let i = 0; i < 5; i++) {
      const mobileBell = vi.fn()
      const leave = subscribeToNotifications(client, 'user-1', mobileBell)
      leave()
    }

    expect(channel.subscribe).toHaveBeenCalledTimes(1)
    expect(client.channel).toHaveBeenCalledTimes(1)
  })

  it('a new channel is created again after every subscriber has left and a new one arrives', () => {
    const { client, channel } = fakeClient()
    const leave = subscribeToNotifications(client, 'user-1', () => {})
    leave()

    subscribeToNotifications(client, 'user-1', () => {})
    expect(client.channel).toHaveBeenCalledTimes(2)
    expect(channel.subscribe).toHaveBeenCalledTimes(2)
  })
})
