/**
 * Processing domain types. Pure data: no I/O, no framework or UI imports, so
 * this module can move into a background worker unchanged.
 */

/** Mirrors papers.status in the database. */
export type ProcessingStatus = 'uploaded' | 'processing' | 'ready' | 'failed'

export type SectionType =
  | 'abstract'
  | 'introduction'
  | 'background'
  | 'related_work'
  | 'methods'
  | 'results'
  | 'discussion'
  | 'conclusion'
  | 'limitations'
  | 'references'
  | 'acknowledgments'
  | 'appendix'
  | 'other'

/** Raw text of one PDF page, as produced by a PdfExtractor. */
export type ExtractedPage = {
  /** 1-based page number. */
  pageNumber: number
  text: string
}

/** What a PdfExtractor returns. Extractor-specific details stay inside the adapter. */
export type ExtractedDocument = {
  pageCount: number
  pages: ExtractedPage[]
}

/** Whole-document text after normalization, with a page lookup table. */
export type NormalizedDocument = {
  pageCount: number
  /** All page texts joined by a blank line. */
  text: string
  /** pageStarts[i] is the offset in `text` where page i + 1 begins. */
  pageStarts: number[]
  /** pageNumbers[i] is the original page number of the i-th entry. */
  pageNumbers: number[]
}

export type DocumentSection = {
  /** 0-based order in the document. */
  position: number
  title: string
  sectionType: SectionType
  /** Body text of the section, excluding its heading line. May be empty. */
  text: string
  /** Offset of `text` within NormalizedDocument.text. */
  charStart: number
  pageStart: number | null
  pageEnd: number | null
}

export type DocumentChunk = {
  /** 0-based order across the whole paper. */
  chunkIndex: number
  /** Position of the section this chunk belongs to. */
  sectionPosition: number
  text: string
  /** Offsets within the owning section's text. `text === section.text.slice(charStart, charEnd)`. */
  charStart: number
  charEnd: number
  pageStart: number | null
  pageEnd: number | null
}

/**
 * Chunk sizes are measured in CHARACTERS (UTF-16 code units), not model tokens.
 * For English prose one token is roughly 4 characters, so the default target of
 * 3600 characters is only *approximately* 700-1000 tokens. Swap in a real
 * tokenizer later if exact token budgets matter.
 */
export type ChunkOptions = {
  /** Soft upper bound on chunk length, in characters. */
  targetChars: number
  /** Approximate amount of trailing text repeated at the start of the next chunk, in characters. */
  overlapChars: number
}

export type ProcessingOptions = {
  chunk: ChunkOptions
}

export type ProcessedDocument = {
  pageCount: number
  sections: DocumentSection[]
  chunks: DocumentChunk[]
}

export type ProcessingErrorCode =
  | 'invalid_pdf'
  | 'encrypted_pdf'
  | 'no_extractable_text'
  | 'extraction_failed'
  | 'timeout'

export type ProcessingFailure = {
  code: ProcessingErrorCode
  /** Safe to store in papers.processing_error and show to the user. */
  message: string
}

export type ProcessingOutcome =
  | { ok: true; document: ProcessedDocument }
  | { ok: false; error: ProcessingFailure }
