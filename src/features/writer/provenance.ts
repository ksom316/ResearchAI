import { z } from 'zod'
import type { ExtractionSource, FieldKey } from '#/features/evidence-matrix/types'
import type { WriterDb } from './writer-db.server'
import {
  MAX_WRITER_SOURCE_TEXT_CHARS,
  MAX_WRITER_TITLE_CHARS,
} from './evidence'
import { boundedWriterText, sanitizeWriterLine } from './sanitize'
import { writerEvidenceLocatorSchema } from './schemas'
import type { WriterEvidenceLocator, WriterSourceRecord } from './types'

export const writerProvenanceRequestSchema = z.strictObject({
  projectId: z.uuid().transform((value) => value.toLowerCase()),
  locator: writerEvidenceLocatorSchema,
})

export type WriterProvenanceRequest = z.infer<typeof writerProvenanceRequestSchema>

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

export type WriterLocatorResolutionError =
  | 'unauthenticated'
  | 'scope_not_found'
  | 'paper_not_ready'
  | 'stale'
  | 'not_found'
  | 'unusable'
  | 'unavailable'

export type WriterLocatorResolution =
  | { ok: true; provenance: WriterCitationProvenance[] }
  | { ok: false; error: WriterLocatorResolutionError }

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

/** Resolves a complete locator set through one authenticated project scope. */
export async function resolveWriterEvidenceLocators(
  projectId: string,
  locators: readonly WriterEvidenceLocator[],
  db: WriterDb,
): Promise<WriterLocatorResolution> {
  try {
    if (!(await db.getUserId())) return { ok: false, error: 'unauthenticated' }
    if (!(await db.getProject(projectId))) {
      return { ok: false, error: 'scope_not_found' }
    }

    const papers = await db.listProjectPapers(projectId)
    const papersById = new Map(papers.map((paper) => [paper.id, paper]))
    for (const locator of locators) {
      const paper = papersById.get(locator.paperId)
      if (!paper) return { ok: false, error: 'scope_not_found' }
      if (paper.status !== 'ready') {
        return { ok: false, error: 'paper_not_ready' }
      }
    }

    const extractionLocators = locators.filter(
      (locator): locator is Extract<
        WriterEvidenceLocator,
        { kind: 'extraction_claim' }
      > => locator.kind === 'extraction_claim',
    )
    const chunkLocators = locators.filter(
      (locator): locator is Extract<WriterEvidenceLocator, { kind: 'chunk' }> =>
        locator.kind === 'chunk',
    )
    const extractionPaperIds = extractionLocators.map(
      (locator) => locator.paperId,
    )
    const fieldKeys = extractionLocators.map((locator) => locator.fieldKey)

    const [overviews, fields, sources, directChunks, sections] =
      await Promise.all([
        db.listExtractionOverviews(extractionPaperIds),
        db.listExtractionFields(extractionPaperIds, fieldKeys),
        db.listExtractionSources(extractionPaperIds, fieldKeys),
        db.listChunks(chunkLocators.map((locator) => locator.chunkId)),
        db.listSections(chunkLocators.map((locator) => locator.sectionId)),
      ])
    const sourceChunkIds = sources.flatMap((source) =>
      source.chunkId ? [source.chunkId] : [],
    )
    const sourceChunks = await db.listChunks(sourceChunkIds)
    const directChunksById = new Map(
      directChunks.map((chunk) => [chunk.id, chunk]),
    )
    const sectionsById = new Map(
      sections.map((section) => [section.id, section]),
    )
    const sourceChunksById = new Map(
      sourceChunks.map((chunk) => [chunk.id, chunk]),
    )

    const resolved: WriterCitationProvenance[] = []
    for (const locator of locators) {
      const paper = papersById.get(locator.paperId)!
      const paperTitle = sanitizeWriterLine(paper.title, MAX_WRITER_TITLE_CHARS)

      if (locator.kind === 'chunk') {
        const chunk = directChunksById.get(locator.chunkId)
        const section = sectionsById.get(locator.sectionId)
        if (
          !chunk ||
          chunk.paperId !== locator.paperId ||
          chunk.sectionId !== locator.sectionId ||
          !section ||
          section.paperId !== locator.paperId
        ) {
          return { ok: false, error: 'not_found' }
        }
        const content = boundedWriterText(chunk.text, MAX_WRITER_SOURCE_TEXT_CHARS)
        if (!content) return { ok: false, error: 'unusable' }
        resolved.push({
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
              content,
            },
          ],
        })
        continue
      }

      const matchingOverviews = overviews.filter(
        (row) =>
          row.paperId === locator.paperId &&
          row.schemaVersion === locator.schemaVersion,
      )
      if (matchingOverviews.some((row) => row.isStale)) {
        return { ok: false, error: 'stale' }
      }
      const overview = matchingOverviews.find(
        (row) =>
          !row.isStale &&
          (row.status === 'complete' || row.status === 'partial'),
      )
      if (!overview) return { ok: false, error: 'not_found' }

      const field = fields.find(
        (row) =>
          row.paperId === locator.paperId &&
          row.schemaVersion === locator.schemaVersion &&
          row.fieldKey === locator.fieldKey,
      )
      if (!field) return { ok: false, error: 'not_found' }
      if (field.state !== 'extracted' || field.itemsMalformed) {
        return { ok: false, error: 'unusable' }
      }
      const claim = field.items[locator.itemIndex]?.text.trim()
      if (!claim) return { ok: false, error: 'unusable' }

      const matchingSources = sources
        .filter(
          (source) =>
            source.paperId === locator.paperId &&
            source.schemaVersion === locator.schemaVersion &&
            source.fieldKey === locator.fieldKey &&
            source.itemIndex === locator.itemIndex,
        )
        .sort(
          (a, b) =>
            a.ord - b.ord ||
            (a.chunkId ?? '').localeCompare(b.chunkId ?? ''),
        )
      if (matchingSources.length === 0) {
        return { ok: false, error: 'unusable' }
      }
      resolved.push({
        kind: 'extraction_claim',
        paperId: paper.id,
        paperTitle,
        fieldKey: locator.fieldKey,
        claimText: boundedWriterText(claim, 500),
        sources: matchingSources.map((source) => {
          const chunk = source.chunkId
            ? sourceChunksById.get(source.chunkId)
            : undefined
          const chunkText =
            chunk?.paperId === locator.paperId &&
            (!source.sectionId || chunk.sectionId === source.sectionId)
              ? chunk.text
              : null
          return sourceRecord(source, chunkText)
        }),
      })
    }
    return { ok: true, provenance: resolved }
  } catch {
    return { ok: false, error: 'unavailable' }
  }
}

/** Authenticated, project-scoped lazy resolution of one server-issued locator. */
export async function resolveWriterProvenance(
  raw: unknown,
  deps: { db: WriterDb },
): Promise<WriterProvenanceResult> {
  const parsed = writerProvenanceRequestSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: 'invalid_request' }
  const result = await resolveWriterEvidenceLocators(
    parsed.data.projectId,
    [parsed.data.locator],
    deps.db,
  )
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === 'unavailable' ? 'unavailable' : 'not_found',
    }
  }
  return { ok: true, provenance: result.provenance[0] }
}
