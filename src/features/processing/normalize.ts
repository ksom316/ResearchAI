import type { ExtractedDocument, NormalizedDocument } from './types'

// Typographic ligatures that PDFs often emit as single code points (U+FB00-FB04).
const LIGATURES: readonly (readonly [string, string])[] = [
  [String.fromCodePoint(0xfb00), 'ff'],
  [String.fromCodePoint(0xfb01), 'fi'],
  [String.fromCodePoint(0xfb02), 'fl'],
  [String.fromCodePoint(0xfb03), 'ffi'],
  [String.fromCodePoint(0xfb04), 'ffl'],
]

/**
 * Cleans one page of extracted text. Deliberately conservative: it only fixes
 * encoding noise and whitespace, and never removes or rewrites words.
 * (No de-hyphenation: joining "state-\nof-the-art" style breaks is ambiguous.)
 */
export function normalizeText(raw: string): string {
  let text = raw.replace(/\r\n?/g, '\n')
  for (const [ligature, replacement] of LIGATURES) {
    text = text.replaceAll(ligature, replacement)
  }
  return (
    text
      // Drop NUL and other control characters except tab and newline.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/\xA0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/** Normalizes every page and joins them into one text with a page lookup table. */
export function normalizeDocument(doc: ExtractedDocument): NormalizedDocument {
  const pages = [...doc.pages].sort((a, b) => a.pageNumber - b.pageNumber)
  let text = ''
  const pageStarts: number[] = []
  const pageNumbers: number[] = []

  for (const page of pages) {
    const pageText = normalizeText(page.text)
    if (pageText === '') continue // blank pages contribute no text
    if (text !== '') text += '\n\n'
    pageStarts.push(text.length)
    pageNumbers.push(page.pageNumber)
    text += pageText
  }

  return { pageCount: doc.pageCount, text, pageStarts, pageNumbers }
}

/** Page number containing `offset` in the normalized text, or null if there are no pages. */
export function pageAt(doc: NormalizedDocument, offset: number): number | null {
  if (doc.pageStarts.length === 0) return null
  let lo = 0
  let hi = doc.pageStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (doc.pageStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return doc.pageNumbers[lo]
}
