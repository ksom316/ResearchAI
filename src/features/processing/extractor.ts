import type { ExtractedDocument } from './types'

/**
 * The seam between the deterministic pipeline and whatever actually parses PDFs
 * (pdf.js, a worker service, ...). Implementations must throw ProcessingError
 * with a user-safe message for invalid, encrypted or unreadable files.
 *
 * No implementation ships in Phase 3A: where parsing runs is a deployment
 * decision that must be made before Phase 3B.
 */
export interface PdfExtractor {
  extract: (pdf: Uint8Array) => Promise<ExtractedDocument>
}
