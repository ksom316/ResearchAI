import type { ProcessedDocument, ProcessingFailure } from './types'

/**
 * Pure mappers from processing results to database rows. No I/O: a future
 * worker (using the service role) is responsible for writing them, ideally in
 * one transaction, and for setting status = 'processing' beforehand.
 */

export type SectionRow = {
  id: string
  paper_id: string
  user_id: string
  position: number
  title: string
  section_type: string
  page_start: number | null
  page_end: number | null
  text: string
}

export type ChunkRow = {
  id: string
  paper_id: string
  user_id: string
  section_id: string
  chunk_index: number
  text: string
  char_start: number
  char_end: number
  page_start: number | null
  page_end: number | null
}

export function buildPersistenceRows(
  owner: { paperId: string; userId: string },
  document: ProcessedDocument,
  newId: () => string = () => crypto.randomUUID(),
): { sections: SectionRow[]; chunks: ChunkRow[] } {
  const sectionIds = new Map<number, string>()
  const sections = document.sections.map((s): SectionRow => {
    const id = newId()
    sectionIds.set(s.position, id)
    return {
      id,
      paper_id: owner.paperId,
      user_id: owner.userId,
      position: s.position,
      title: s.title.slice(0, 300),
      section_type: s.sectionType,
      page_start: s.pageStart,
      page_end: s.pageEnd,
      text: s.text,
    }
  })
  const chunks = document.chunks.map((c): ChunkRow => {
    const sectionId = sectionIds.get(c.sectionPosition)
    if (!sectionId) {
      throw new Error(`Chunk ${c.chunkIndex} references a missing section`)
    }
    return {
      id: newId(),
      paper_id: owner.paperId,
      user_id: owner.userId,
      section_id: sectionId,
      chunk_index: c.chunkIndex,
      text: c.text,
      char_start: c.charStart,
      char_end: c.charEnd,
      page_start: c.pageStart,
      page_end: c.pageEnd,
    }
  })
  return { sections, chunks }
}

/** papers columns to write when processing starts. */
export function processingStartedUpdate(now: Date = new Date()) {
  return {
    status: 'processing' as const,
    processing_started_at: now.toISOString(),
    processing_completed_at: null,
    processing_error: null,
  }
}

/** papers columns to write on success. Satisfies papers_processing_consistency_check. */
export function processingSucceededUpdate(
  document: ProcessedDocument,
  now: Date = new Date(),
) {
  return {
    status: 'ready' as const,
    processing_completed_at: now.toISOString(),
    processing_error: null,
    page_count: Math.max(1, document.pageCount),
  }
}

/** papers columns to write on failure. */
export function processingFailedUpdate(
  failure: ProcessingFailure,
  now: Date = new Date(),
) {
  return {
    status: 'failed' as const,
    processing_completed_at: now.toISOString(),
    processing_error: failure.message.slice(0, 1000),
  }
}
