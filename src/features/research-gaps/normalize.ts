import {
  canonicalText,
  normalizePhrase,
} from '#/features/research-map/normalize'
import { extractCandidates } from '#/features/research-map/terms'

export const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Whole statements only. Preserve punctuation, negation, numbers and word order. */
export function statementKey(text: string): string {
  return canonicalText(text)
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\.$/u, '')
}

const VAGUE = new Set(
  `future further research work opportunity opportunities limitation limitations limited
  coverage explore exploring investigate investigating evaluate evaluating extend extending
  test testing develop developing compare comparing lack lacks requires required needed
  potential possible additional broader extensive insufficient restricted unable`.split(
    /\s+/u,
  ),
)

/**
 * Require the shared map term AND another multiword content phrase. The latter must
 * contain at least two non-boilerplate words, independent of the relationship anchor.
 * This is a lexical specificity gate, not a semantic interpretation of the statement.
 */
export function isSpecific(text: string, termKey: string): boolean {
  const normalized = normalizePhrase(text)
  const anchor = normalizePhrase(termKey)
  if (!anchor || !` ${normalized} `.includes(` ${anchor} `)) return false
  const anchorWords = new Set(anchor.split(' '))
  if (normalized.split(' ').length < 6) return false
  return extractCandidates(text).some((candidate) => {
    const words = candidate.key.split(' ')
    // Do not let a cue such as "limited" turn generic "training data" into
    // apparently specific content. Reapply the map's generic/weak-word filter.
    if (words.some((word) => anchorWords.has(word) || VAGUE.has(word)))
      return false
    return words.length >= 2
  })
}
