import type { DocumentClassification, ExtractionQuality, ProcessedDocument, ProcessingFailure } from './types'

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
  /** R12: distinguishes prose chunks from the synthetic, searchable chunks
   * generated from a detected table or structured fact. Embedding/search
   * (chunk_embeddings, search_paper_chunks) treat every row the same way
   * regardless of source_kind - this is what lets tables and facts become
   * retrievable without any change to the embedding worker or the search RPC. */
  source_kind: 'text' | 'table' | 'fact'
  source_table_id: string | null
}

/** R12: one row per detected page, used for extraction-quality display and OCR routing. */
export type PageRow = {
  paper_id: string
  user_id: string
  page_number: number
  char_count: number
  likely_scanned: boolean
  ocr_status: 'not_required' | 'required'
}

/** R12: one row per detected table, kept as a header + row grid (see types.ts). */
export type TableRow = {
  id: string
  paper_id: string
  user_id: string
  table_index: number
  page_start: number
  page_end: number
  caption: string | null
  headers: string[]
  rows: string[][]
  confidence: number
}

/** R12: one row per structured fact, with provenance back to its page/table. */
export type FactRow = {
  id: string
  paper_id: string
  user_id: string
  metric: string
  value: number | null
  unit: string | null
  currency: string | null
  period: string | null
  raw_text: string
  page_number: number | null
  table_id: string | null
  confidence: number
}

export type PersistenceRows = {
  sections: SectionRow[]
  chunks: ChunkRow[]
  pages: PageRow[]
  tables: TableRow[]
  facts: FactRow[]
}

/** Builds a short, de-duplicated header line for a table's synthetic chunk text. */
function tableChunkText(table: ProcessedDocument['tables'][number]): string {
  const caption = table.caption ? `${table.caption}\n` : ''
  const header = table.headers.length > 0 ? `${table.headers.join(' | ')}\n` : ''
  const body = table.rows.map((r) => r.join(' | ')).join('\n')
  return `${caption}${header}${body}`.trim()
}

function factChunkText(fact: ProcessedDocument['facts'][number]): string {
  const value =
    fact.value !== null
      ? `${fact.currency ?? ''}${fact.value}${fact.unit && fact.unit !== 'percent' ? ` ${fact.unit}` : fact.unit === 'percent' ? '%' : ''}`
      : null
  const period = fact.period ? ` (${fact.period})` : ''
  return value
    ? `${fact.metric.replace(/_/g, ' ')}${period}: ${value} - "${fact.rawText}"`
    : `${fact.metric.replace(/_/g, ' ')}${period}: "${fact.rawText}"`
}

export function buildPersistenceRows(
  owner: { paperId: string; userId: string },
  document: ProcessedDocument,
  newId: () => string = () => crypto.randomUUID(),
): PersistenceRows {
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

  // The first section anchors synthetic table/fact chunks when there is no
  // more specific section to attach them to (e.g. a table outside any
  // detected heading). Every paper that reaches persistence has at least one
  // section: processExtractedDocument always returns 'Full text' as a
  // fallback when no headings are found.
  const fallbackSectionId = sections[0]?.id

  let chunkIndex = document.chunks.reduce((max, c) => Math.max(max, c.chunkIndex), -1) + 1
  const chunks: ChunkRow[] = document.chunks.map((c): ChunkRow => {
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
      source_kind: 'text',
      source_table_id: null,
    }
  })

  const tableIds = new Map<number, string>()
  const tables: TableRow[] = document.tables.map((t): TableRow => {
    const id = newId()
    tableIds.set(t.tableIndex, id)
    if (fallbackSectionId) {
      const text = tableChunkText(t)
      if (text !== '') {
        chunks.push({
          id: newId(),
          paper_id: owner.paperId,
          user_id: owner.userId,
          section_id: fallbackSectionId,
          chunk_index: chunkIndex++,
          text,
          char_start: 0,
          char_end: text.length,
          page_start: t.pageStart,
          page_end: t.pageEnd,
          source_kind: 'table',
          source_table_id: id,
        })
      }
    }
    return {
      id,
      paper_id: owner.paperId,
      user_id: owner.userId,
      table_index: t.tableIndex,
      page_start: t.pageStart,
      page_end: t.pageEnd,
      caption: t.caption,
      headers: t.headers,
      rows: t.rows,
      confidence: t.confidence,
    }
  })

  const facts: FactRow[] = document.facts.map((f): FactRow => {
    const id = newId()
    const tableId = f.tableIndex !== null ? tableIds.get(f.tableIndex) ?? null : null
    if (fallbackSectionId) {
      const text = factChunkText(f)
      chunks.push({
        id: newId(),
        paper_id: owner.paperId,
        user_id: owner.userId,
        section_id: fallbackSectionId,
        chunk_index: chunkIndex++,
        text,
        char_start: 0,
        char_end: text.length,
        page_start: f.pageNumber,
        page_end: f.pageNumber,
        source_kind: 'fact',
        source_table_id: tableId,
      })
    }
    return {
      id,
      paper_id: owner.paperId,
      user_id: owner.userId,
      metric: f.metric,
      value: f.value,
      unit: f.unit,
      currency: f.currency,
      period: f.period,
      raw_text: f.rawText,
      page_number: f.pageNumber,
      table_id: tableId,
      confidence: f.confidence,
    }
  })

  const pages: PageRow[] = document.pages.map((p): PageRow => ({
    paper_id: owner.paperId,
    user_id: owner.userId,
    page_number: p.pageNumber,
    char_count: p.charCount,
    likely_scanned: p.likelyScanned,
    ocr_status: p.likelyScanned ? 'required' : 'not_required',
  }))

  return { sections, chunks, pages, tables, facts }
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
    extraction_quality: document.extractionQuality satisfies ExtractionQuality,
    document_type: document.classification.documentType,
    document_type_confidence: document.classification.confidence,
    document_type_method: document.classification.method satisfies DocumentClassification['method'],
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
    extraction_quality:
      failure.code === 'no_extractable_text'
        ? ('no_extractable_text' as const satisfies ExtractionQuality)
        : null,
  }
}
