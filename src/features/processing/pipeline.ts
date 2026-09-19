import { chunkSections, DEFAULT_CHUNK_OPTIONS } from './chunker'
import {
  FAILURE_MESSAGES,
  ProcessingError,
  toProcessingFailure,
} from './errors'
import type { PdfExtractor } from './extractor'
import { normalizeDocument } from './normalize'
import { detectSections } from './section-detector'
import type {
  ExtractedDocument,
  ProcessedDocument,
  ProcessingOptions,
  ProcessingOutcome,
} from './types'

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
  if (normalized.text === '') {
    throw new ProcessingError(
      'no_extractable_text',
      FAILURE_MESSAGES.no_extractable_text,
    )
  }
  const sections = detectSections(normalized)
  const chunks = chunkSections(normalized, sections, options.chunk)
  return { pageCount: normalized.pageCount, sections, chunks }
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
