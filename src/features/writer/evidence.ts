import type {
  ExtractionField,
  ExtractionOverview,
  ExtractionSource,
  FieldKey,
} from '#/features/evidence-matrix/types'
import type { SearchHit } from '#/features/search/types'
import { boundedWriterText, sanitizeWriterLine } from './sanitize'
import type {
  WriterEvidenceItem,
  WriterEvidenceLocator,
  WriterEvidencePacket,
  WriterMode,
  WriterSourceRecord,
} from './types'

export const MAX_WRITER_EVIDENCE_ITEMS = 12
export const MAX_WRITER_EVIDENCE_CHARS = 18_000
export const MAX_WRITER_PARTICIPATING_PAPERS = 5
export const MAX_WRITER_SEMANTIC_TEXT_CHARS = 3_000
export const MAX_WRITER_SOURCE_TEXT_CHARS = 1_200
export const MAX_WRITER_SOURCES_PER_CLAIM = 3
export const MAX_WRITER_TITLE_CHARS = 200
export const MAX_WRITER_SECTION_TITLE_CHARS = 300
export const WRITER_SEMANTIC_RETRIEVAL_LIMIT = 24

export type WriterPaper = {
  id: string
  title: string
  status: 'uploaded' | 'processing' | 'ready' | 'failed'
}

export type WriterLiveChunk = {
  id: string
  paperId: string
  sectionId: string
  text: string
  pageStart: number | null
  pageEnd: number | null
}

export type MatrixEvidenceData = {
  papers: readonly WriterPaper[]
  overviews: readonly ExtractionOverview[]
  fields: readonly ExtractionField[]
  sources: readonly ExtractionSource[]
  chunks: readonly WriterLiveChunk[]
}

export type EvidenceCandidate = Omit<WriterEvidenceItem, 'id'> & {
  identity: string
  sortKey: string
}

export const MODE_FIELDS: Record<
  Exclude<WriterMode, 'literature_synthesis'>,
  readonly FieldKey[]
> = {
  compare_studies: ['objective', 'methodology', 'dataset', 'findings'],
  methodology_summary: ['methodology', 'dataset'],
  findings_synthesis: ['findings'],
  limitations_future_work: ['limitations', 'future_work'],
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const sourceKey = (source: ExtractionSource) =>
  JSON.stringify([
    source.paperId,
    source.schemaVersion,
    source.fieldKey,
    source.itemIndex,
    source.ord,
  ])

export function evidenceIdentity(locator: WriterEvidenceLocator): string {
  return locator.kind === 'chunk'
    ? JSON.stringify(['chunk', locator.paperId, locator.chunkId])
    : JSON.stringify([
        'extraction_claim',
        locator.paperId,
        locator.schemaVersion,
        locator.fieldKey,
        locator.itemIndex,
      ])
}

function chooseStableDuplicate(
  current: EvidenceCandidate,
  candidate: EvidenceCandidate,
): EvidenceCandidate {
  return JSON.stringify(candidate) < JSON.stringify(current)
    ? candidate
    : current
}

/**
 * Exact-provenance deduplication followed by deterministic paper round-robin selection.
 * Whole items are retained or skipped; W ids are assigned only after this step.
 */
export function finalizeEvidencePacket(
  candidates: readonly EvidenceCandidate[],
): WriterEvidencePacket {
  const unique = new Map<string, EvidenceCandidate>()
  for (const candidate of candidates) {
    const existing = unique.get(candidate.identity)
    unique.set(
      candidate.identity,
      existing ? chooseStableDuplicate(existing, candidate) : candidate,
    )
  }

  const ordered = [...unique.values()].sort(
    (a, b) => compare(a.sortKey, b.sortKey) || compare(a.identity, b.identity),
  )
  const byPaper = new Map<string, EvidenceCandidate[]>()
  for (const candidate of ordered) {
    byPaper.set(candidate.paperId, [
      ...(byPaper.get(candidate.paperId) ?? []),
      candidate,
    ])
  }
  const paperIds = [...byPaper]
    .sort(
      ([aId, a], [bId, b]) =>
        compare(a[0]?.sortKey ?? '', b[0]?.sortKey ?? '') || compare(aId, bId),
    )
    .slice(0, MAX_WRITER_PARTICIPATING_PAPERS)
    .map(([paperId]) => paperId)

  const selected: EvidenceCandidate[] = []
  let totalPromptChars = 0
  let round = 0
  let progressed = true
  while (progressed && selected.length < MAX_WRITER_EVIDENCE_ITEMS) {
    progressed = false
    for (const paperId of paperIds) {
      if (selected.length >= MAX_WRITER_EVIDENCE_ITEMS) break
      const candidate = byPaper.get(paperId)?.[round]
      if (!candidate) continue
      progressed = true
      if (
        candidate.promptText.length === 0 ||
        totalPromptChars + candidate.promptText.length >
          MAX_WRITER_EVIDENCE_CHARS
      )
        continue
      selected.push(candidate)
      totalPromptChars += candidate.promptText.length
    }
    round++
  }

  const items = selected.map(
    ({ identity: _identity, sortKey: _sortKey, ...item }, index) => ({
      ...item,
      id: `W${index + 1}` as const,
    }),
  )
  return {
    items,
    paperIds: [...new Set(items.map((item) => item.paperId))],
    totalPromptChars,
  }
}

export function semanticEvidenceCandidates(
  hits: readonly SearchHit[],
): EvidenceCandidate[] {
  return hits.map((hit) => {
    const content = boundedWriterText(
      hit.content,
      MAX_WRITER_SEMANTIC_TEXT_CHARS,
    )
    const paperTitle = sanitizeWriterLine(
      hit.paperTitle,
      MAX_WRITER_TITLE_CHARS,
    )
    const sectionTitle = sanitizeWriterLine(
      hit.sectionTitle,
      MAX_WRITER_SECTION_TITLE_CHARS,
    )
    const locator: WriterEvidenceLocator = {
      kind: 'chunk',
      paperId: hit.paperId,
      chunkId: hit.chunkId,
      sectionId: hit.sectionId,
    }
    const source: WriterSourceRecord = {
      chunkId: hit.chunkId,
      sectionId: hit.sectionId,
      sectionTitle,
      sectionType: sanitizeWriterLine(hit.sectionType, 100),
      pageStart: hit.pageStart,
      pageEnd: hit.pageEnd,
      excerpt: null,
      content,
    }
    return {
      identity: evidenceIdentity(locator),
      sortKey: JSON.stringify([
        String(hit.rank).padStart(6, '0'),
        hit.paperId,
        String(hit.chunkIndex).padStart(8, '0'),
        hit.chunkId,
      ]),
      locator,
      paperId: hit.paperId,
      paperTitle,
      claimText: null,
      sourceRecords: [source],
      promptText: content,
      isStale: false,
    }
  })
}

type CanonicalRow<T> = { row: T | null; conflicted: boolean }

function canonicalNewest<T extends { updatedAt: string }>(
  rows: readonly T[],
): CanonicalRow<T> {
  if (rows.length === 0) return { row: null, conflicted: false }
  const newest = [...rows].sort((a, b) => compare(b.updatedAt, a.updatedAt))[0]
  const tied = rows.filter((row) => row.updatedAt === newest.updatedAt)
  const forms = new Map(tied.map((row) => [JSON.stringify(row), row]))
  return forms.size === 1
    ? { row: [...forms.values()][0], conflicted: false }
    : { row: null, conflicted: true }
}

function sourceRecord(
  source: ExtractionSource,
  chunks: ReadonlyMap<string, WriterLiveChunk>,
): WriterSourceRecord {
  const resolvedChunk = source.chunkId ? chunks.get(source.chunkId) : undefined
  const chunk =
    resolvedChunk?.paperId === source.paperId &&
    resolvedChunk.sectionId === source.sectionId
      ? resolvedChunk
      : undefined
  return {
    chunkId: source.chunkId,
    sectionId: source.sectionId,
    sectionTitle: sanitizeWriterLine(
      source.sectionTitle,
      MAX_WRITER_SECTION_TITLE_CHARS,
    ),
    sectionType: sanitizeWriterLine(source.sectionType, 100),
    pageStart: source.pageStart,
    pageEnd: source.pageEnd,
    excerpt: source.excerpt
      ? boundedWriterText(source.excerpt, MAX_WRITER_SOURCE_TEXT_CHARS)
      : null,
    content: chunk?.text
      ? boundedWriterText(chunk.text, MAX_WRITER_SOURCE_TEXT_CHARS)
      : null,
  }
}

function claimPrompt(
  claim: string,
  sources: readonly WriterSourceRecord[],
): string {
  const support = sources
    .map((source, index) => {
      const text = source.content ?? source.excerpt
      return text ? `Source ${index + 1}: ${text}` : ''
    })
    .filter(Boolean)
  return [`Claim: ${claim}`, ...support].join('\n')
}

export function matrixEvidenceCandidates(
  data: MatrixEvidenceData,
  mode: Exclude<WriterMode, 'literature_synthesis'>,
  scopedPaperIds: ReadonlySet<string>,
  stale: boolean,
): EvidenceCandidate[] {
  const allowedFields = MODE_FIELDS[mode]
  const chunks = new Map(data.chunks.map((chunk) => [chunk.id, chunk]))
  const papers = [...data.papers]
    .filter((paper) => scopedPaperIds.has(paper.id))
    .sort(
      (a, b) =>
        compare(a.title.toLowerCase(), b.title.toLowerCase()) ||
        compare(a.id, b.id),
    )
  const candidates: EvidenceCandidate[] = []

  for (const paper of papers) {
    const overviewChoice = canonicalNewest(
      data.overviews.filter((overview) => overview.paperId === paper.id),
    )
    const overview = overviewChoice.row
    if (
      overviewChoice.conflicted ||
      !overview ||
      overview.isStale !== stale ||
      (overview.status !== 'complete' && overview.status !== 'partial')
    )
      continue

    for (const [fieldOrder, fieldKey] of allowedFields.entries()) {
      const fieldChoice = canonicalNewest(
        data.fields.filter(
          (field) =>
            field.paperId === paper.id &&
            field.schemaVersion === overview.schemaVersion &&
            field.fieldKey === fieldKey,
        ),
      )
      const field = fieldChoice.row
      if (
        fieldChoice.conflicted ||
        !field ||
        field.state !== 'extracted' ||
        field.itemsMalformed ||
        field.items.length === 0
      )
        continue

      field.items.forEach((item, itemIndex) => {
        const uniqueSources = new Map<string, ExtractionSource>()
        for (const source of data.sources) {
          if (
            source.paperId === paper.id &&
            source.schemaVersion === overview.schemaVersion &&
            source.fieldKey === fieldKey &&
            source.itemIndex === itemIndex
          ) {
            const key = sourceKey(source)
            const existing = uniqueSources.get(key)
            if (
              !existing ||
              JSON.stringify(source) < JSON.stringify(existing)
            ) {
              uniqueSources.set(key, source)
            }
          }
        }
        const sources = [...uniqueSources.values()]
          .sort(
            (a, b) =>
              a.ord - b.ord || compare(a.chunkId ?? '', b.chunkId ?? ''),
          )
          .slice(0, MAX_WRITER_SOURCES_PER_CLAIM)
          .map((source) => sourceRecord(source, chunks))
        if (sources.length === 0) return

        const claimText = boundedWriterText(item.text, 500)
        if (claimText === '') return
        const locator: WriterEvidenceLocator = {
          kind: 'extraction_claim',
          paperId: paper.id,
          schemaVersion: overview.schemaVersion,
          fieldKey,
          itemIndex,
        }
        candidates.push({
          identity: evidenceIdentity(locator),
          sortKey: JSON.stringify([
            paper.title.toLowerCase(),
            paper.id,
            String(fieldOrder).padStart(2, '0'),
            String(itemIndex).padStart(3, '0'),
          ]),
          locator,
          paperId: paper.id,
          paperTitle: sanitizeWriterLine(paper.title, MAX_WRITER_TITLE_CHARS),
          claimText,
          sourceRecords: sources,
          promptText: claimPrompt(claimText, sources),
          isStale: stale,
        })
      })
    }
  }
  return candidates
}

export function comparablePaperCount(
  candidates: readonly EvidenceCandidate[],
): number {
  const byField = new Map<FieldKey, Set<string>>()
  for (const candidate of candidates) {
    if (candidate.locator.kind !== 'extraction_claim') continue
    const papers = byField.get(candidate.locator.fieldKey) ?? new Set<string>()
    papers.add(candidate.paperId)
    byField.set(candidate.locator.fieldKey, papers)
  }
  return Math.max(0, ...[...byField.values()].map((papers) => papers.size))
}
