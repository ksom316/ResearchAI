import type {
  ExtractedDocument,
  ExtractionQuality,
  PageProfile,
} from './types'

/**
 * Deterministic document profiling (R12). Runs before OCR decisions: it only
 * looks at character density per page, the cheapest possible signal, so every
 * paper pays for this even when it never needs OCR.
 */

/**
 * Fewer non-whitespace characters than this on a single page is treated as
 * "likely scanned" (an image page, or a stray page number on an otherwise
 * blank page). Tuned well below a typical dense paragraph's lower bound.
 */
export const LIKELY_SCANNED_PAGE_CHARS = 40

function nonWhitespaceLength(text: string): number {
  return text.replace(/\s/g, '').length
}

/** Per-page profile used for extraction quality and selective-OCR routing. */
export function profilePages(extracted: ExtractedDocument): PageProfile[] {
  return [...extracted.pages]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => {
      const charCount = nonWhitespaceLength(page.text)
      return {
        pageNumber: page.pageNumber,
        charCount,
        likelyScanned: charCount < LIKELY_SCANNED_PAGE_CHARS,
      }
    })
}

/**
 * Document-level extraction quality from the per-page profile. The caller is
 * responsible for the hard 'no_extractable_text' failure (see pipeline.ts
 * MIN_MEANINGFUL_CHARS); this only distinguishes the shades of "has some
 * text" that matter downstream:
 *  - 'successful':    almost no scanned pages.
 *  - 'partial':       a minority of pages are likely scanned (mixed digital
 *                      + scanned document) - usable, but some pages are gaps.
 *  - 'ocr_required':  most pages are likely scanned; OCR would materially help.
 *  - 'poor':          there is a document-worth of text, but it is thin
 *                      everywhere (e.g. a badly reflowed scan-to-text PDF),
 *                      so more OCR on individual pages would not fix it.
 */
export function computeExtractionQuality(
  pages: readonly PageProfile[],
): ExtractionQuality {
  if (pages.length === 0) return 'poor'
  const scannedCount = pages.filter((p) => p.likelyScanned).length
  const scannedRatio = scannedCount / pages.length
  const avgChars =
    pages.reduce((sum, p) => sum + p.charCount, 0) / pages.length

  if (scannedRatio >= 0.6) return 'ocr_required'
  if (scannedRatio > 0) return 'partial'
  if (avgChars < LIKELY_SCANNED_PAGE_CHARS * 3) return 'poor'
  return 'successful'
}
