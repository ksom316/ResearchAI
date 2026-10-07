import type { DocumentClassification, DocumentSection, DocumentType } from './types'

/**
 * Deterministic document classification (R12). Keyword/structure signals only
 * - no LLM call, so classifying a paper never costs AI usage or allowance.
 * Each rule reports a score; the highest-scoring type wins if it clears
 * MIN_CONFIDENCE, otherwise the document is honestly 'unknown' rather than
 * forced into a guess.
 *
 * This is intentionally the smallest useful classifier, not a general text
 * classification model. A future LLM fallback for low-confidence documents
 * (DocumentTypeMethod = 'llm') can be added behind the same return shape
 * without touching callers; see R12 report for why it is not wired yet.
 */

export const MIN_CONFIDENCE = 0.34

type Rule = { type: DocumentType; pattern: RegExp; weight: number }

const RULES: readonly Rule[] = [
  // Financial statements are the strongest, most literal signal available.
  { type: 'financial', pattern: /\bconsolidated (?:statements? of|balance sheet)\b/i, weight: 3 },
  { type: 'financial', pattern: /\b(?:income statement|balance sheet|cash flow statement|statement of cash flows)\b/i, weight: 2 },
  { type: 'financial', pattern: /\b(?:net income|total assets|total liabilities|gross margin|operating expenses?)\b/i, weight: 1 },
  { type: 'financial', pattern: /\b10-K\b|\bform 10-k\b/i, weight: 2 },

  { type: 'annual_report', pattern: /\bannual report\b/i, weight: 3 },
  { type: 'annual_report', pattern: /\bletter to (?:our )?shareholders\b/i, weight: 2 },
  { type: 'annual_report', pattern: /\bfiscal year \d{4}\b/i, weight: 1 },

  { type: 'government', pattern: /\b(?:department of|ministry of|office of the inspector general)\b/i, weight: 2 },
  { type: 'government', pattern: /\bgovernment accountability office|federal register\b/i, weight: 2 },

  { type: 'policy', pattern: /\bpolicy (?:brief|paper|framework|recommendations?)\b/i, weight: 3 },
  { type: 'policy', pattern: /\bregulatory impact\b|\bwhite paper\b/i, weight: 1 },

  { type: 'market_research', pattern: /\bmarket (?:research|size|share|forecast)\b/i, weight: 2 },
  { type: 'market_research', pattern: /\bcompetitive landscape\b|\bindustry report\b/i, weight: 2 },

  { type: 'thesis', pattern: /\b(?:a (?:thesis|dissertation) submitted|in partial fulfillment of the requirements)\b/i, weight: 3 },
  { type: 'thesis', pattern: /\bdoctor of philosophy\b|\bmaster'?s thesis\b/i, weight: 2 },

  { type: 'case_study', pattern: /\bcase stud(?:y|ies)\b/i, weight: 2 },

  { type: 'survey', pattern: /\bsurvey (?:results|methodology|respondents)\b/i, weight: 2 },
  { type: 'survey', pattern: /\bwe surveyed\b|\bquestionnaire\b/i, weight: 1 },

  { type: 'technical', pattern: /\btechnical report\b/i, weight: 2 },
  { type: 'technical', pattern: /\barchitecture diagram\b|\bimplementation details\b/i, weight: 1 },

  { type: 'academic', pattern: /\bdoi:\s*10\.\d{4,9}\//i, weight: 2 },
  { type: 'academic', pattern: /\b(?:abstract|introduction|related work|methodology|conclusion)\b/i, weight: 1 },
  { type: 'academic', pattern: /\bpeer[- ]reviewed\b|\bconference on\b|\bproceedings of\b/i, weight: 1 },
]

/** Keyword/structural scoring over the document's normalized text and section titles. */
export function classifyDocument(
  text: string,
  sections: readonly DocumentSection[],
): DocumentClassification {
  const haystack = `${text}\n${sections.map((s) => s.title).join('\n')}`
  const scores = new Map<DocumentType, number>()

  for (const rule of RULES) {
    const matches = haystack.match(rule.pattern)
    if (!matches) continue
    scores.set(rule.type, (scores.get(rule.type) ?? 0) + rule.weight)
  }

  if (scores.size === 0) {
    return { documentType: 'general_report', confidence: 0, method: 'deterministic' }
  }

  const total = [...scores.values()].reduce((a, b) => a + b, 0)
  let best: DocumentType = 'unknown'
  let bestScore = 0
  for (const [type, score] of scores) {
    if (score > bestScore) {
      best = type
      bestScore = score
    }
  }
  const confidence = total > 0 ? bestScore / total : 0

  if (confidence < MIN_CONFIDENCE) {
    return { documentType: 'unknown', confidence, method: 'deterministic' }
  }
  return { documentType: best, confidence, method: 'deterministic' }
}
