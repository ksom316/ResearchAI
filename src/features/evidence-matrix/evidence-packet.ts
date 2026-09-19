import { FIELD_KEYS, routeSection } from './fields'
import type { FieldKey } from './fields'

/** Explicit bounds: a huge thesis can never create an unbounded prompt. */
export const MAX_EVIDENCE_ITEMS = 40
/**
 * 24,000 = 6 x MAX_CHUNK_CHARS. Fields take turns picking one new chunk each, in
 * FIELD_KEYS order, so this is the smallest budget that still guarantees the first six
 * fields a full-size chunk each in the worst case. The seventh, concepts, is covered by
 * whatever objective picked (abstract/introduction are routed to both).
 */
export const MAX_EVIDENCE_CHARS = 24_000
/** A chunk longer than this is dropped whole, never truncated (provenance stays exact). */
export const MAX_CHUNK_CHARS = 4_000

export type PaperSectionInput = {
  id: string
  title: string
  sectionType: string
}

export type PaperChunkInput = {
  id: string
  sectionId: string
  chunkIndex: number
  /** Exactly as stored in paper_chunks.text. Never modified. */
  text: string
  pageStart: number | null
  pageEnd: number | null
}

export type PaperInput = {
  paperId: string
  sections: readonly PaperSectionInput[]
  chunks: readonly PaperChunkInput[]
}

export type EvidenceItem = {
  /** E1, E2, ... in document order. */
  id: string
  paperId: string
  chunkId: string
  sectionId: string
  sectionTitle: string
  sectionType: string
  pageStart: number | null
  pageEnd: number | null
  /** Exact chunk text. */
  text: string
  /** The fields this chunk may be cited for. */
  fields: readonly FieldKey[]
}

export type EvidencePacket = {
  paperId: string
  items: readonly EvidenceItem[]
  byId: ReadonlyMap<string, EvidenceItem>
  /** Fields with no routed evidence; the model must return not_reported for them. */
  emptyFields: readonly FieldKey[]
  /** Routable chunks left out (budget / oversized). */
  droppedChunks: number
}

type Candidate = {
  chunk: PaperChunkInput
  section: PaperSectionInput
  routes: Partial<Record<FieldKey, number>>
}

/**
 * Deterministic, bounded evidence for ONE paper.
 *  - unroutable, empty and duplicate-id chunks are skipped (identical text in different
 *    chunks is kept: each has its own section/page provenance)
 *  - candidates per field are ranked (type priority, then document order); fields take
 *    turns, so no field starves the others when the budget runs out
 *  - a chunk that does not fit the remaining budget is dropped whole; smaller later
 *    candidates may still fit
 *  - selected chunks get E1.. in document order
 */
export function buildEvidencePacket(paper: PaperInput): EvidencePacket {
  const sections = new Map(paper.sections.map((s) => [s.id, s]))
  const seenIds = new Set<string>()

  const candidates: Candidate[] = []
  const ordered = [...paper.chunks].sort(
    (a, b) =>
      a.chunkIndex - b.chunkIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  for (const chunk of ordered) {
    if (seenIds.has(chunk.id)) continue
    const section = sections.get(chunk.sectionId)
    if (!section || chunk.text.trim() === '') continue
    const routes = routeSection(section.sectionType, section.title)
    if (Object.keys(routes).length === 0) continue
    seenIds.add(chunk.id)
    candidates.push({ chunk, section, routes })
  }

  const queues = new Map<FieldKey, Candidate[]>()
  for (const key of FIELD_KEYS) {
    queues.set(
      key,
      candidates
        .filter((c) => c.routes[key] !== undefined)
        .sort(
          (a, b) =>
            (a.routes[key] as number) - (b.routes[key] as number) ||
            a.chunk.chunkIndex - b.chunk.chunkIndex,
        ),
    )
  }

  const selected = new Set<Candidate>()
  const cursors = new Map<FieldKey, number>(FIELD_KEYS.map((k) => [k, 0]))
  let chars = 0
  let progressed = true
  while (progressed && selected.size < MAX_EVIDENCE_ITEMS) {
    progressed = false
    for (const key of FIELD_KEYS) {
      if (selected.size >= MAX_EVIDENCE_ITEMS) break
      const queue = queues.get(key) as Candidate[]
      let i = cursors.get(key) as number
      while (i < queue.length) {
        const cand = queue[i++]
        if (selected.has(cand)) continue
        const len = cand.chunk.text.length
        if (len > MAX_CHUNK_CHARS || chars + len > MAX_EVIDENCE_CHARS) continue
        selected.add(cand)
        chars += len
        progressed = true
        break
      }
      cursors.set(key, i)
    }
  }

  const chosen = candidates.filter((c) => selected.has(c))
  const items: EvidenceItem[] = chosen.map((c, i) => ({
    id: `E${i + 1}`,
    paperId: paper.paperId,
    chunkId: c.chunk.id,
    sectionId: c.section.id,
    sectionTitle: c.section.title,
    sectionType: c.section.sectionType,
    pageStart: c.chunk.pageStart,
    pageEnd: c.chunk.pageEnd,
    text: c.chunk.text,
    fields: FIELD_KEYS.filter((k) => c.routes[k] !== undefined),
  }))
  return {
    paperId: paper.paperId,
    items,
    byId: new Map(items.map((e) => [e.id, e])),
    emptyFields: FIELD_KEYS.filter(
      (k) => !items.some((e) => e.fields.includes(k)),
    ),
    droppedChunks: candidates.length - chosen.length,
  }
}
