/** Phase 6A.2: the seven fixed Evidence Matrix fields and deterministic routing rules. */

export const FIELD_KEYS = [
  'objective',
  'methodology',
  'dataset',
  'findings',
  'limitations',
  'future_work',
  'concepts',
] as const

/** The only schema version this code produces; the request RPC hard-codes the same 1. */
export const EVIDENCE_SCHEMA_VERSION = 1

export type FieldKey = (typeof FIELD_KEYS)[number]

export type RoutingRule = {
  /** Section types routed to the field, most relevant first (drives budget priority). */
  types: readonly string[]
  /**
   * Normalized heading phrases. For a section of type 'other' (a heading the section
   * detector did not recognize) a phrase may occur anywhere in the title as whole
   * words. For every other type only an exact title match counts.
   */
  titles: readonly string[]
}

export const ROUTING: Record<FieldKey, RoutingRule> = {
  objective: {
    types: ['abstract', 'introduction'],
    titles: [
      'objective',
      'objectives',
      'aim',
      'aims',
      'research questions',
      'problem statement',
    ],
  },
  methodology: {
    types: ['methods'],
    titles: [
      'methodology',
      'method',
      'methods',
      'experimental',
      'experimental setup',
      'experiments',
      'setup',
      'approach',
      'proposed method',
      'procedure',
    ],
  },
  dataset: {
    types: ['methods'],
    titles: [
      'dataset',
      'datasets',
      'data',
      'data collection',
      'participants',
      'sample',
      'materials',
      'materials and methods',
      'corpus',
    ],
  },
  findings: {
    types: ['results', 'discussion'],
    titles: ['findings', 'results', 'evaluation', 'experimental results'],
  },
  limitations: {
    types: ['limitations', 'discussion'],
    titles: ['limitation', 'limitations', 'threats to validity', 'caveats'],
  },
  future_work: {
    types: ['conclusion', 'limitations'],
    titles: [
      'future work',
      'future directions',
      'future research',
      'conclusions',
    ],
  },
  concepts: {
    types: ['abstract', 'introduction', 'background', 'related_work'],
    titles: ['keywords', 'preliminaries', 'background'],
  },
}

/** Never routed, whatever their heading says. */
const EXCLUDED_TYPES = new Set(['references', 'acknowledgments', 'appendix'])

/**
 * Lowercase, drop leading numbering ("2.1", "IV.", "3)", "A."), turn punctuation into
 * spaces and collapse whitespace: "3.2 Experimental Set-up:" -> "experimental set up".
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^\s*(?:(?:\d+|[ivxlc]+|[a-z])(?:\.\d+)*[.):]?\s+)+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function titleMatches(
  normalized: string,
  phrases: readonly string[],
  sectionType: string,
) {
  if (normalized === '') return false
  if (sectionType !== 'other') return phrases.includes(normalized)
  const padded = ` ${normalized} `
  return phrases.some((p) => padded.includes(` ${p} `))
}

/**
 * Fields a section feeds, with a priority per field (lower = more relevant): the index
 * of its type in the rule's `types`, or 100 for a title-only match.
 */
export function routeSection(
  sectionType: string,
  sectionTitle: string,
): Partial<Record<FieldKey, number>> {
  if (EXCLUDED_TYPES.has(sectionType)) return {}
  const normalized = normalizeTitle(sectionTitle)
  const out: Partial<Record<FieldKey, number>> = {}
  for (const key of FIELD_KEYS) {
    const rule = ROUTING[key]
    const typeIndex = rule.types.indexOf(sectionType)
    if (typeIndex >= 0) out[key] = typeIndex
    else if (titleMatches(normalized, rule.titles, sectionType)) out[key] = 100
  }
  return out
}
