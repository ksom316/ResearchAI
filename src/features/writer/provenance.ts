import { z } from 'zod'
import { FIELD_KEYS } from '#/features/evidence-matrix/fields'
import type { ExtractionSource, FieldKey } from '#/features/evidence-matrix/types'
import type { WriterDb } from './writer-db.server'
import {
  MAX_WRITER_SOURCE_TEXT_CHARS,
  MAX_WRITER_TITLE_CHARS,
} from './evidence'
import { boundedWriterText, sanitizeWriterLine } from './sanitize'
import type { WriterEvidenceLocator, WriterSourceRecord } from './types'

const locatorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('chunk'),
    paperId: z.uuid(),
    chunkId: z.uuid(),
    sectionId: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal('extraction_claim'),
    paperId: z.uuid(),
    schemaVersion: z.number().int().positive(),
    fieldKey: z.enum(FIELD_KEYS),
    itemIndex: z.number().int().min(0),
  }),
])

export const writerProvenanceRequestSchema = z.strictObject({
  projectId: z.uuid(),
  locator: locatorSchema,
})

export type WriterProvenanceRequest = z.infer<
  typeof writerProvenanceRequestSchema
>

export type WriterSectionRecord = {
  id: string
  paperId: string
  title: string
  sectionType: string
  pageStart: number | null
  pageEnd: number | null
}

export type WriterCitationProvenance = {
  kind: WriterEvidenceLocator['kind']
  paperId: string
  paperTitle: string
  fieldKey: FieldKey | null
  claimText: string | null
  sources: WriterSourceRecord[]
}

export type WriterProvenanceResult =
  | { ok: true; provenance: WriterCitationProvenance }
  | { ok: false; error: 'invalid_request' | 'not_found' | 'unavailable' }

export type WriterProvenanceDeps = {
  db: WriterDb
  getSection: (paperId: string, sectionId: string) => Promise<WriterSectionRecord | null>
}

function sourceRecord(
  source: ExtractionSource,
  chunkText: string | null,
): WriterSourceRecord {
  return {
    chunkId: source.chunkId,
    sectionId: source.sectionId,
    sectionTitle: sanitizeWriterLine(source.sectionTitle, 300),
    sectionType: sanitizeWriterLine(source.sectionType, 100),
    pageStart: source.pageStart,
    pageEnd: source.pageEnd,
    excerpt: source.excerpt
      ? boundedWriterText(source.excerpt, MAX_WRITER_SOURCE_TEXT_CHARS)
      : null,
    content: chunkText
      ? boundedWriterText(chunkText, MAX_WRITER_SOURCE_TEXT_CHARS)
      : null,
  }
}

/** Authenticated, project-scoped lazy resolution of one server-issued locator. */
export async function resolveWriterProvenance(
  raw: unknown,
  deps: WriterProvenanceDeps,
): Promise<WriterProvenanceResult> {
  const parsed = writerProvenanceRequestSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_request' }
  const { projectId, locator } = parsed.data

  try {
    if (!(await deps.db.getUserId())) return { ok: false, error: 'not_found' }
    if (!(await deps.db.getProject(projectId))) return { ok: false, error: 'not_found' }
    const paper = (await deps.db.listProjectPapers(projectId)).find(
      (candidate) => candidate.id === locator.paperId,
    )
    if (!paper) return { ok: false, error: 'not_found' }
    const paperTitle = sanitizeWriterLine(paper.title, MAX_WRITER_TITLE_CHARS)

    if (locator.kind === 'chunk') {
      const chunk = (await deps.db.listChunks([locator.chunkId])).find(
        (candidate) =>
          candidate.id === locator.chunkId &&
          candidate.paperId === locator.paperId &&
          candidate.sectionId === locator.sectionId,
      )
      if (!chunk) return { ok: false, error: 'not_found' }
      const section = await deps.getSection(locator.paperId, locator.sectionId)
      if (!section) return { ok: false, error: 'not_found' }
      return {
        ok: true,
        provenance: {
          kind: 'chunk',
          paperId: paper.id,
          paperTitle,
          fieldKey: null,
          claimText: null,
          sources: [
            {
              chunkId: chunk.id,
              sectionId: section.id,
              sectionTitle: sanitizeWriterLine(section.title, 300),
              sectionType: sanitizeWriterLine(section.sectionType, 100),
              pageStart: chunk.pageStart ?? section.pageStart,
              pageEnd: chunk.pageEnd ?? section.pageEnd,
              excerpt: null,
              content: boundedWriterText(
                chunk.text,
                MAX_WRITER_SOURCE_TEXT_CHARS,
              ),
            },
          ],
        },
      }
    }

    const [overviews, fields, sources] = await Promise.all([
      deps.db.listExtractionOverviews([paper.id]),
      deps.db.listExtractionFields([paper.id], [locator.fieldKey]),
      deps.db.listExtractionSources([paper.id], [locator.fieldKey]),
    ])
    const overview = overviews.find(
      (row) =>
        row.paperId === paper.id &&
        row.schemaVersion === locator.schemaVersion &&
        !row.isStale &&
        (row.status === 'complete' || row.status === 'partial'),
    )
    const field = fields.find(
      (row) =>
        row.paperId === paper.id &&
        row.schemaVersion === locator.schemaVersion &&
        row.fieldKey === locator.fieldKey &&
        row.state === 'extracted' &&
        !row.itemsMalformed,
    )
    const claim = field?.items[locator.itemIndex]?.text.trim()
    if (!overview || !field || !claim) return { ok: false, error: 'not_found' }
    const matching = sources
      .filter(
        (source) =>
          source.schemaVersion === locator.schemaVersion &&
          source.fieldKey === locator.fieldKey &&
          source.itemIndex === locator.itemIndex,
      )
      .sort((a, b) => a.ord - b.ord)
    if (matching.length === 0) return { ok: false, error: 'not_found' }
    const chunkIds = matching.flatMap((source) =>
      source.chunkId ? [source.chunkId] : [],
    )
    const chunks = new Map(
      (await deps.db.listChunks(chunkIds))
        .filter((chunk) => chunk.paperId === paper.id)
        .map((chunk) => [chunk.id, chunk]),
    )
    return {
      ok: true,
      provenance: {
        kind: 'extraction_claim',
        paperId: paper.id,
        paperTitle,
        fieldKey: locator.fieldKey,
        claimText: boundedWriterText(claim, 500),
        sources: matching.map((source) =>
          sourceRecord(source, source.chunkId ? chunks.get(source.chunkId)?.text ?? null : null),
        ),
      },
    }
  } catch {
    return { ok: false, error: 'unavailable' }
  }
}
