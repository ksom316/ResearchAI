import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  FAILURE_MESSAGES,
  ProcessingError,
} from '../src/features/processing/errors'
import type { PdfExtractor } from '../src/features/processing/extractor'
import type {
  ExtractedDocument,
  ExtractedPage,
} from '../src/features/processing/types'
import { itemsToText } from './text-layout'
import type { LayoutItem } from './text-layout'

/** Maps pdf.js exceptions (identified by name) to safe processing errors. */
export function mapPdfJsError(error: unknown): ProcessingError {
  if (error instanceof ProcessingError) return error
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String(error.name)
      : ''
  switch (name) {
    case 'PasswordException':
      return new ProcessingError(
        'encrypted_pdf',
        FAILURE_MESSAGES.encrypted_pdf,
      )
    case 'InvalidPDFException':
    case 'MissingPDFException':
    case 'FormatError':
      return new ProcessingError('invalid_pdf', FAILURE_MESSAGES.invalid_pdf)
    default:
      return new ProcessingError(
        'extraction_failed',
        FAILURE_MESSAGES.extraction_failed,
      )
  }
}

function isLayoutItem(item: unknown): item is LayoutItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof (item as LayoutItem).str === 'string' &&
    Array.isArray((item as LayoutItem).transform)
  )
}

/**
 * Extracts per-page text with pdf.js (legacy build, which runs on plain Node).
 * Page numbers are pdf.js's 1-based page indexes, returned in ascending order;
 * pages without a text layer come back as empty strings. No OCR.
 *
 * `timeoutMs` is a cooperative deadline checked between pages: pdf.js cannot be
 * interrupted mid-page, so a single pathological page can overrun it.
 */
export class PdfJsExtractor implements PdfExtractor {
  private readonly timeoutMs: number

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 120_000
  }

  async extract(pdf: Uint8Array): Promise<ExtractedDocument> {
    const deadline = Date.now() + this.timeoutMs
    let loadingTask: ReturnType<typeof getDocument> | undefined
    try {
      // pdf.js takes ownership of the buffer it is given, so hand it a copy.
      loadingTask = getDocument({
        data: new Uint8Array(pdf),
        disableFontFace: true,
        useSystemFonts: false,
        verbosity: 0,
      })
      const doc = await loadingTask.promise

      const pages: ExtractedPage[] = []
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        if (Date.now() > deadline) {
          throw new ProcessingError('timeout', FAILURE_MESSAGES.timeout)
        }
        const page = await doc.getPage(pageNumber)
        const content = await page.getTextContent()
        pages.push({
          pageNumber,
          text: itemsToText(
            content.items.flatMap((item) => (isLayoutItem(item) ? [item] : [])),
          ),
        })
        page.cleanup()
      }
      return { pageCount: doc.numPages, pages }
    } catch (error) {
      throw mapPdfJsError(error)
    } finally {
      await loadingTask?.destroy().catch(() => undefined)
    }
  }
}
