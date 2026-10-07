/**
 * Realtime wiring (R13) over Supabase's existing Realtime infrastructure (no
 * third-party realtime service). This is the first Realtime usage in the
 * codebase, so it is built as thin, swappable glue around a small interface
 * rather than calling the Supabase client directly everywhere - which is what
 * makes the subscribe/cleanup logic below unit-testable without a live
 * connection (see realtime.test.ts for the fake channel used instead).
 *
 * Authorization: Supabase Realtime's postgres_changes feed is filtered
 * server-side by each table's RLS policies for the subscriber's own JWT - the
 * same policies that gate a normal select - so a client can only ever receive
 * change events for rows it could already read. No separate authorization
 * step is needed here (verified structurally; live behavior cannot be
 * exercised from this environment - see R13 report).
 *
 * The invalidation-only strategy below (an event triggers a refetch, never a
 * manual cache patch) is deliberate: it avoids the standard realtime
 * failure modes - duplicate inserts, out-of-order updates, merge races -
 * at the cost of one extra round trip per event, which is the right
 * trade-off for a feed, not a high-frequency stream.
 *
 * SHARED-CHANNEL FIX (production incident): more than one component can
 * legitimately want the same topic at the same time - e.g. AppShell always
 * mounts the desktop sidebar's NotificationBell (merely CSS-hidden on
 * mobile, not unmounted) AND mounts a second NotificationBell inside the
 * mobile drawer once it opens. supabase-js's realtime-js deduplicates
 * channels by topic: client.channel(topic) returns the SAME RealtimeChannel
 * instance if one already exists for that topic. The second mount's
 * `.on(...)` call therefore landed on a channel the first mount had already
 * `.subscribe()`d, which realtime-js rejects ("cannot add `postgres_changes`
 * callbacks ... after `subscribe()`"). `joinSharedChannel` below makes this
 * module itself dedupe per (client, topic): the channel is created, given
 * its `.on()` handlers and `.subscribe()`d exactly once per topic, no matter
 * how many callers ask for it; every later caller just registers its own
 * callback against the already-live channel and gets an independent
 * unsubscribe that only tears the channel down once the last caller leaves.
 */

export type RealtimeTable =
  | 'discussions'
  | 'comments'
  | 'notifications'
  | 'assignments'
  | 'notes'
  | 'project_activity'

/** The slice of the supabase-js client this module actually uses. */
export type RealtimeClient = {
  channel: (topic: string) => RealtimeChannelLike
  removeChannel: (channel: RealtimeChannelLike) => void
}

export type RealtimeChannelLike = {
  on: (
    event: 'postgres_changes',
    filter: { event: '*'; schema: 'public'; table: RealtimeTable; filter: string },
    callback: () => void,
  ) => RealtimeChannelLike
  subscribe: () => RealtimeChannelLike
}

type SharedChannel<TListener> = {
  channel: RealtimeChannelLike
  listeners: Set<TListener>
}

/**
 * Joins a channel shared across every caller that asks for the same
 * (client, topic) pair. The first caller's `createChannel` actually builds
 * the channel (registers `.on()` handlers against `dispatch`, then
 * `.subscribe()`s); every later caller for the same topic skips straight to
 * registering its own listener against the channel that already exists, so
 * `.on()`/`.subscribe()` are never called again on an already-subscribed
 * channel. The returned cleanup only calls `client.removeChannel` once the
 * last listener for that topic has left.
 */
function joinSharedChannel<TListener>(
  registry: Map<string, SharedChannel<TListener>>,
  client: RealtimeClient,
  topic: string,
  listener: TListener,
  createChannel: (dispatch: TListener) => RealtimeChannelLike,
): () => void {
  let shared = registry.get(topic)
  if (!shared) {
    const listeners = new Set<TListener>()
    // Fans out to every registered listener; its own shape (no-arg vs
    // table-arg) is supplied by each call site below.
    const dispatch = ((...args: unknown[]) => {
      for (const registered of listeners) {
        ;(registered as (...a: unknown[]) => void)(...args)
      }
    }) as TListener
    shared = { channel: createChannel(dispatch), listeners }
    registry.set(topic, shared)
  }
  shared.listeners.add(listener)

  return () => {
    const current = registry.get(topic)
    if (!current) return // already torn down (e.g. a double-unmount)
    current.listeners.delete(listener)
    if (current.listeners.size === 0) {
      registry.delete(topic)
      client.removeChannel(current.channel)
    }
  }
}

// Keyed by the Supabase client so tests (each with their own fake client) and
// a future second client never share state; in production there is exactly
// one client singleton (see lib/supabase/client.ts), so this is keyed by
// topic alone in practice.
const collaborationChannels = new WeakMap<
  RealtimeClient,
  Map<string, SharedChannel<(table: RealtimeTable) => void>>
>()
const notificationChannels = new WeakMap<RealtimeClient, Map<string, SharedChannel<() => void>>>()

function registryFor<TListener>(
  store: WeakMap<RealtimeClient, Map<string, SharedChannel<TListener>>>,
  client: RealtimeClient,
): Map<string, SharedChannel<TListener>> {
  let registry = store.get(client)
  if (!registry) {
    registry = new Map()
    store.set(client, registry)
  }
  return registry
}

/** One Postgres-changes subscription per table, each scoped to one project. */
export function subscribeToProjectCollaboration(
  client: RealtimeClient,
  projectId: string,
  onChange: (table: RealtimeTable) => void,
): () => void {
  const topic = `collaboration:${projectId}`
  return joinSharedChannel(registryFor(collaborationChannels, client), client, topic, onChange, (dispatch) => {
    const channel = client.channel(topic)
    const tables: RealtimeTable[] = [
      'discussions',
      'comments',
      'assignments',
      'notes',
      'project_activity',
    ]
    for (const table of tables) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `project_id=eq.${projectId}` },
        () => dispatch(table),
      )
    }
    channel.subscribe()
    return channel
  })
}

/** The caller's own notifications, filtered by recipient rather than project. */
export function subscribeToNotifications(
  client: RealtimeClient,
  userId: string,
  onChange: () => void,
): () => void {
  const topic = `notifications:${userId}`
  return joinSharedChannel(registryFor(notificationChannels, client), client, topic, onChange, (dispatch) => {
    const channel = client.channel(topic)
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
      dispatch,
    )
    channel.subscribe()
    return channel
  })
}
