import { normalizePhrase } from '#/features/research-map/normalize'
import type {
  GapActionFamily,
  GapClaimFieldKey,
  GapContextFamily,
  GapTargetFamily,
} from './types'

/** Reviewed aliases only. Changing these requires a ruleset version bump. */
export const ACTION_ALIASES: Record<
  GapClaimFieldKey,
  Partial<Record<GapActionFamily, readonly string[]>>
> = {
  future_work: {
    integrate: ['integrate', 'integrating', 'incorporate', 'incorporating'],
    evaluate: ['evaluate'],
    build: ['build', 'building'],
  },
  limitations: {
    scope_restriction: ['limited', 'restricted'],
    missing_capability: ['lack', 'lacks'],
    inability: ['cannot', 'unable'],
    insufficiency: ['insufficient'],
  },
}

export const TARGET_ALIASES: Record<GapTargetFamily, readonly string[]> = {
  language_model: ['language model', 'language models'],
  table_structure: [
    'table structure',
    'table structure recognition',
    'structure recognition',
    'TSR',
  ],
  table_content: [
    'table content',
    'content recognition',
    'cell content',
    'cell-content',
    'L-OCR',
  ],
}

/** Ambiguous aliases that require a context in the same claim. */
export const GUARDED_TARGET_ALIASES: Record<GapTargetFamily, readonly string[]> = {
  language_model: ['large model', 'large models'],
  table_structure: [],
  table_content: [],
}

export const CONTEXT_ALIASES: Record<GapContextFamily, readonly string[]> = {
  table_recognition_domain: ['table recognition', 'table understanding'],
}

/** Exact normalized token-sequence matching; never substring or fuzzy matching. */
export function containsAlias(text: string, alias: string): boolean {
  const normalizedText = normalizePhrase(text)
  const normalizedAlias = normalizePhrase(alias)
  return (
    normalizedAlias !== '' &&
    ` ${normalizedText} `.includes(` ${normalizedAlias} `)
  )
}

export function containsAnyAlias(
  text: string,
  aliases: readonly string[],
): boolean {
  return aliases.some((alias) => containsAlias(text, alias))
}
