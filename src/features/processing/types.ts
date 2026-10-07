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

/**
 * Document type, used to steer specialized downstream understanding (R12).
 * Deterministic, keyword-based signals only for now; 'unknown' is the honest
 * default when no signal is strong enough. See classifier.ts.
 */
export type DocumentType =
  | 'academic'
  | 'financial'
  | 'annual_report'
  | 'government'
  | 'policy'
  | 'technical'
  | 'market_research'
  | 'thesis'
  | 'case_study'
  | 'survey'
  | 'general_report'
  | 'unknown'

export type DocumentTypeMethod = 'deterministic' | 'llm'

export type DocumentClassification = {
  documentType: DocumentType
  confidence: number
  method: DocumentTypeMethod
}

/**
 * How much the extracted text for this document can be trusted downstream.
 * Mirrors papers.extraction_quality (R12). 'no_extractable_text' is a hard
 * failure elsewhere (ProcessingError), so it never appears here; it is listed
 * for completeness with the database check constraint.
 */
export type ExtractionQuality =
  | 'successful'
  | 'partial'
  | 'poor'
  | 'no_extractable_text'
  | 'ocr_required'

/** Deterministic per-page signal used for extraction quality and OCR routing. */
export type PageProfile = {
  pageNumber: number
  charCount: number
  /** True when this page's digital text is too sparse to trust (candidate for OCR). */
  likelyScanned: boolean
}

/**
 * A detected table, kept as a header + row grid rather than flattened prose
 * (R12 table intelligence). Cell values are the exact extracted strings: no
 * numeric coercion here, so provenance always matches what is on the page.
 */
export type DetectedTable = {
  /** 0-based order among tables in the document. */
  tableIndex: number
  pageStart: number
  pageEnd: number
  /** Nearest heading-like line above the table, if any. */
  caption: string | null
  headers: string[]
  rows: string[][]
  /** 0-1 heuristic confidence from column-count consistency across rows. */
  confidence: number
}

/**
 * A structured fact pulled from prose or a table cell (R12 structured facts /
 * financial understanding). Intentionally narrow: a labeled metric with a
 * value, not a general-purpose accounting model.
 */
export type DetectedFact = {
  metric: string
  /** Raw numeric value as written (already unit-stripped); null if unparsable. */
  value: number | null
  unit: string | null
  currency: string | null
  /** Fiscal/calendar period as written, e.g. "FY2025", "2024", "Q3 2025". */
  period: string | null
  /** The exact text the fact was read from, for human verification. */
  rawText: string
  pageNumber: number | null
  /** Index into ProcessedDocument.tables when the fact came from a table cell. */
  tableIndex: number | null
  confidence: number
}

export type ProcessedDocument = {
  pageCount: number
  sections: DocumentSection[]
  chunks: DocumentChunk[]
  pages: PageProfile[]
  extractionQuality: ExtractionQuality
  classification: DocumentClassification
  tables: DetectedTable[]
  facts: DetectedFact[]
}

export type ProcessingErrorCode =
  | 'invalid_pdf'
  | 'encrypted_pdf'
  | 'no_extractable_text'
  | 'extraction_failed'
  | 'timeout'
  | 'storage_error'
  | 'persistence_error'

export type ProcessingFailure = {
  code: ProcessingErrorCode
  /** Safe to store in papers.processing_error and show to the user. */
  message: string
}

export type ProcessingOutcome =
  | { ok: true; document: ProcessedDocument }
  | { ok: false; error: ProcessingFailure }
