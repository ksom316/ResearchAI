import { chunkSections, DEFAULT_CHUNK_OPTIONS } from './chunker'
import { classifyDocument } from './classifier'
import {
  FAILURE_MESSAGES,
  ProcessingError,
  toProcessingFailure,
} from './errors'
import type { PdfExtractor } from './extractor'
import { extractFactsFromTables, extractFactsFromText } from './fact-extractor'
import { normalizeDocument } from './normalize'
import { computeExtractionQuality, profilePages } from './profiler'
import { detectSections } from './section-detector'
import { detectTables } from './table-detector'
import type {
  ExtractedDocument,
  ProcessedDocument,
  ProcessingOptions,
  ProcessingOutcome,
} from './types'

/**
 * Fewer non-whitespace characters than this across the whole document is
 * treated as "no extractable text" (typically a scan with stray page numbers).
 */
export const MIN_MEANINGFUL_CHARS = 50

export const DEFAULT_PROCESSING_OPTIONS: ProcessingOptions = {
  chunk: DEFAULT_CHUNK_OPTIONS,
}

/**
 * Pure and synchronous: extracted pages -> normalized text -> sections -> chunks.
 * Throws ProcessingError('no_extractable_text') if the document has no text.
 */
export function processExtractedDocument(
  extracted: ExtractedDocument,
  options: ProcessingOptions = DEFAULT_PROCESSING_OPTIONS,
): ProcessedDocument {
  const normalized = normalizeDocument(extracted)
  if (normalized.text.replace(/\s/g, '').length < MIN_MEANINGFUL_CHARS) {
    throw new ProcessingError(
      'no_extractable_text',
      FAILURE_MESSAGES.no_extractable_text,
    )
  }
  const sections = detectSections(normalized)
  const chunks = chunkSections(normalized, sections, options.chunk)

  // R12: deterministic document intelligence. All of this is cheap (no AI
  // calls), so it runs for every paper regardless of document type.
  const pages = profilePages(extracted)
  const extractionQuality = computeExtractionQuality(pages)
  const classification = classifyDocument(normalized.text, sections)
  const tables = detectTables(extracted)
  const facts = [
    ...extractFactsFromText(normalized),
    ...extractFactsFromTables(tables),
  ]

  return {
    pageCount: normalized.pageCount,
    sections,
    chunks,
    pages,
    extractionQuality,
    classification,
    tables,
    facts,
  }
}

/**
 * Full boundary: PDF bytes -> persistence-ready result. Never throws; every
 * failure becomes a ProcessingOutcome with a safe message.
 */
export async function processPdf(
  pdf: Uint8Array,
  extractor: PdfExtractor,
  options: ProcessingOptions = DEFAULT_PROCESSING_OPTIONS,
): Promise<ProcessingOutcome> {
  try {
    const extracted = await extractor.extract(pdf)
    return { ok: true, document: processExtractedDocument(extracted, options) }
  } catch (error) {
    return { ok: false, error: toProcessingFailure(error) }
  }
}
