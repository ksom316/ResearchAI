/**
 * "Who is viewing" presence (R13), via Supabase Realtime Presence - transient
 * state only, never written to a database table (see R13 report for why).
 *
 * Authorization: presence state for a topic is visible to anyone who can join
 * that topic. To keep an unauthorized user from ever joining a project's
 * presence topic, the topic must be a PRIVATE Realtime channel (Supabase's
 * "Realtime Authorization" feature: `channel(topic, { config: { private: true } })`
 * plus an RLS policy on `realtime.messages` for that topic) - a public
 * channel has no server-side membership check at all. This module always
 * requests a private channel, but the matching `realtime.messages` RLS
 * policy is NOT included in migration 0024: its exact shape depends on the
 * installed Supabase Realtime version, which could not be verified from this
 * environment, and writing it blind risked a wrong, falsely-reassuring
 * policy. Until that policy is added (see R13 report's remaining
 * limitations), a private channel's own default - reject unless a policy
 * explicitly allows it - means presence FAILS CLOSED (no one can join) rather
 * than leaking to unauthorized users, but it will not actually show anyone
 * until that policy is added. Do not weaken this to a public channel to make
 * it "work" without that policy in place.
 */

export type PresenceUser = { userId: string; name: string | null }

export type PresenceClient = {
  channel: (
    topic: string,
    options: { config: { presence: { key: string }; private: true } },
  ) => PresenceChannelLike
  removeChannel: (channel: PresenceChannelLike) => void
}

export type PresenceChannelLike = {
  on: (
    event: 'presence',
    filter: { event: 'sync' },
    callback: () => void,
  ) => PresenceChannelLike
  subscribe: (callback?: (status: string) => void) => PresenceChannelLike
  track: (state: Record<string, unknown>) => Promise<unknown>
  presenceState: () => Record<string, { userId: string; name: string | null }[]>
}

function presenceTopic(projectId: string, paperId?: string): string {
  return paperId ? `presence:project:${projectId}:paper:${paperId}` : `presence:project:${projectId}`
}

/**
 * Joins a project (or project+paper) presence topic, tracks the current
 * user, and calls `onChange` with the deduplicated list of everyone present
 * whenever membership changes. Returns a cleanup function; calling it leaves
 * the channel, which is how a departed viewer stops appearing to others.
 */
export function joinPresence(
  client: PresenceClient,
  user: PresenceUser,
  scope: { projectId: string; paperId?: string },
  onChange: (users: PresenceUser[]) => void,
): () => void {
  const channel = client.channel(presenceTopic(scope.projectId, scope.paperId), {
    config: { presence: { key: user.userId }, private: true },
  })

  channel.on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState()
    const users = new Map<string, PresenceUser>()
    for (const entries of Object.values(state)) {
      for (const entry of entries) users.set(entry.userId, entry)
    }
    onChange([...users.values()])
  })

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') void channel.track({ userId: user.userId, name: user.name })
  })

  return () => client.removeChannel(channel)
}
