import type { SearchHit } from '#/features/search/types'

export const MAX_EVIDENCE_HITS = 8
export const EVIDENCE_CHAR_BUDGET = 24_000
const MAX_TITLE_CHARS = 200

/** What the LLM sees. No similarity, no ids other than the citation id. */
export type PromptEvidence = {
  id: string
  paperTitle: string
  sectionTitle: string
  sectionType: string
  pages: string
  content: string
}

/** Kept on the server only; the source of truth for every returned citation. */
export type ServerEvidence = {
  id: string
  paperId: string
  paperTitle: string
  chunkId: string
  sectionId: string
  sectionTitle: string
  sectionType: string
  chunkIndex: number
  charStart: number
  charEnd: number
  pageStart: number | null
  pageEnd: number | null
  rank: number
  similarity: number
}

export type EvidenceSet = {
  items: PromptEvidence[]
  byId: Map<string, ServerEvidence>
}

// Citation-shaped text: [S1], [ S23 ], [S1, S2], [S1; S999]
const CITATION_LIKE = /\[\s*S\s*\d+(?:\s*[,;]\s*S?\s*\d+)*\s*\]/gi
// Control (Cc) and format/zero-width/bidi (Cf) characters, except tab and newline.
const UNSAFE = /[\p{Cc}\p{Cf}]/gu
const keepWhitespace = (ch: string) => (ch === '\n' || ch === '\t' ? ch : '')

/**
 * Prompt-facing copy of untrusted text: control/invisible characters removed and
 * citation-shaped markers neutralized so paper text cannot spoof our ids. This does
 * NOT make injection impossible; the system prompt separately marks evidence as data.
 * The database content is never modified.
 */
export function sanitizeEvidenceText(text: string): string {
  return text
    .normalize('NFC')
    .replace(UNSAFE, keepWhitespace)
    .replace(CITATION_LIKE, '[citation removed]')
}

/** Single-line variant for titles. */
function sanitizeLine(text: string): string {
  return sanitizeEvidenceText(text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_CHARS)
}

export function formatPages(start: number | null, end: number | null): string {
  if (start === null) return 'n/a'
  return end === null || end === start ? `${start}` : `${start}-${end}`
}

const overlaps = (a: SearchHit, b: SearchHit) =>
  a.sectionId === b.sectionId &&
  a.charStart < b.charEnd &&
  b.charStart < a.charEnd

/**
 * Retrieval hits -> ordered, budgeted evidence (S1, S2, ...).
 *  - retrieval order is preserved; at most MAX_EVIDENCE_HITS hits are considered
 *  - a hit overlapping a higher-ranked hit of the same section is dropped (no merging)
 *  - whole lowest-ranked items are dropped once the character budget would be exceeded
 *  - chunks are never truncated; if the top item alone exceeds the budget, the result
 *    is empty (the caller then takes the no_evidence path without calling the LLM)
 */
export function buildEvidence(
  hits: readonly SearchHit[],
  budget: number = EVIDENCE_CHAR_BUDGET,
): EvidenceSet {
  const kept: SearchHit[] = []
  const items: PromptEvidence[] = []
  const byId = new Map<string, ServerEvidence>()
  let used = 0

  for (const hit of hits.slice(0, MAX_EVIDENCE_HITS)) {
    if (kept.some((k) => overlaps(k, hit))) continue
    const content = sanitizeEvidenceText(hit.content).trim()
    if (content === '') continue
    // Never truncate: an item that does not fit is dropped whole, along with every
    // lower-ranked item. If the top item alone exceeds the budget there is no evidence.
    if (used + content.length > budget) break

    const id = `S${items.length + 1}`
    used += content.length
    kept.push(hit)
    items.push({
      id,
      paperTitle: sanitizeLine(hit.paperTitle),
      sectionTitle: sanitizeLine(hit.sectionTitle),
      sectionType: hit.sectionType,
      pages: formatPages(hit.pageStart, hit.pageEnd),
      content,
    })
    byId.set(id, {
      id,
      paperId: hit.paperId,
      paperTitle: hit.paperTitle,
      chunkId: hit.chunkId,
      sectionId: hit.sectionId,
      sectionTitle: hit.sectionTitle,
      sectionType: hit.sectionType,
      chunkIndex: hit.chunkIndex,
      charStart: hit.charStart,
      charEnd: hit.charEnd,
      pageStart: hit.pageStart,
      pageEnd: hit.pageEnd,
      rank: hit.rank,
      similarity: hit.similarity,
    })
  }
  return { items, byId }
}
