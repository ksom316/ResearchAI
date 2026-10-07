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

/** One Postgres-changes subscription per table, each scoped to one project. */
export function subscribeToProjectCollaboration(
  client: RealtimeClient,
  projectId: string,
  onChange: (table: RealtimeTable) => void,
): () => void {
  const channel = client.channel(`collaboration:${projectId}`)
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
      () => onChange(table),
    )
  }
  channel.subscribe()
  return () => client.removeChannel(channel)
}

/** The caller's own notifications, filtered by recipient rather than project. */
export function subscribeToNotifications(
  client: RealtimeClient,
  userId: string,
  onChange: () => void,
): () => void {
  const channel = client.channel(`notifications:${userId}`)
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
    onChange,
  )
  channel.subscribe()
  return () => client.removeChannel(channel)
}
