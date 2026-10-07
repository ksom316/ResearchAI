/**
 * Structural @mentions (R13). The composer never parses free text for names:
 * when a user picks someone from the autocomplete list, the picker inserts a
 * TOKEN - `@[[userId:Display Name]]` - into the comment body at the cursor.
 * Submission and rendering both read mentions back out of these tokens, so
 * "who was mentioned" is always exactly "who the author explicitly picked",
 * never a guess from matching text against names (which could affect a user
 * from an unrelated project, or scramble it on word-boundary false positives).
 */

const TOKEN_PATTERN = /@\[\[([0-9a-f-]{36}):([^\]]*)\]\]/g

export type MentionToken = { userId: string; displayName: string }

/** Builds the literal token text to insert into a comment body. */
export function buildMentionToken(userId: string, displayName: string): string {
  // ']' can't appear in a token's display segment; strip it defensively so a
  // crafted display name (unlikely - it comes from profiles.full_name) can
  // never break the token's own delimiters.
  return `@[[${userId}:${displayName.replaceAll(']', '')}]]`
}

/** All mention tokens in a comment body, in order, de-duplicated by user. */
export function extractMentionTokens(body: string): MentionToken[] {
  const seen = new Set<string>()
  const tokens: MentionToken[] = []
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    const [, userId, displayName] = match
    if (seen.has(userId)) continue
    seen.add(userId)
    tokens.push({ userId, displayName })
  }
  return tokens
}

/** Just the distinct mentioned user ids, for the RPC's p_mentioned_user_ids argument. */
export function extractMentionedUserIds(body: string): string[] {
  return extractMentionTokens(body).map((t) => t.userId)
}

export type BodySegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; userId: string; displayName: string }

/** Splits a comment body into plain-text and mention segments, for rendering. */
export function renderMentionBody(body: string): BodySegment[] {
  const segments: BodySegment[] = []
  let lastIndex = 0
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    const [full, userId, displayName] = match
    const index = match.index
    if (index > lastIndex) {
      segments.push({ kind: 'text', text: body.slice(lastIndex, index) })
    }
    segments.push({ kind: 'mention', userId, displayName })
    lastIndex = index + full.length
  }
  if (lastIndex < body.length) {
    segments.push({ kind: 'text', text: body.slice(lastIndex) })
  }
  return segments
}

/**
 * The "@query" the user is currently typing, found by scanning left from the
 * cursor for '@' not preceded by a word character, stopping at whitespace or
 * an existing token. Returns null when the cursor isn't inside a mention
 * trigger, so the composer knows whether to show the autocomplete list.
 */
export function findActiveMentionQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  const precedingChar = at > 0 ? before[at - 1] : ''
  if (/[\w\]]/.test(precedingChar)) return null // "a@b" or right after a token
  const query = before.slice(at + 1)
  if (/[\s[\]]/.test(query)) return null // left the trigger (space, or hit a token's brackets)
  return { start: at, query }
}

/** Replaces the active "@query" at `start` with a completed mention token. */
export function insertMentionToken(
  text: string,
  start: number,
  queryEnd: number,
  userId: string,
  displayName: string,
): { text: string; cursor: number } {
  const token = `${buildMentionToken(userId, displayName)} `
  const newText = text.slice(0, start) + token + text.slice(queryEnd)
  return { text: newText, cursor: start + token.length }
}
