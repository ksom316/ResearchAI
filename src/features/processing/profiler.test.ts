import { describe, expect, it } from 'vitest'
import {
  computeExtractionQuality,
  LIKELY_SCANNED_PAGE_CHARS,
  profilePages,
} from './profiler'
import type { ExtractedDocument } from './types'

function doc(pages: string[]): ExtractedDocument {
  return {
    pageCount: pages.length,
    pages: pages.map((text, i) => ({ pageNumber: i + 1, text })),
  }
}

const dense = 'x'.repeat(LIKELY_SCANNED_PAGE_CHARS * 20)

describe('profilePages', () => {
  it('flags pages below the char threshold as likely scanned', () => {
    const pages = profilePages(doc([dense, '', 'a few stray chars']))
    expect(pages[0].likelyScanned).toBe(false)
    expect(pages[1].likelyScanned).toBe(true)
    expect(pages[2].likelyScanned).toBe(true)
  })

  it('sorts by page number regardless of input order', () => {
    const out = profilePages({
      pageCount: 2,
      pages: [
        { pageNumber: 2, text: dense },
        { pageNumber: 1, text: dense },
      ],
    })
    expect(out.map((p) => p.pageNumber)).toEqual([1, 2])
  })
})

describe('computeExtractionQuality', () => {
  it('reports successful when almost nothing is scanned', () => {
    const pages = profilePages(doc([dense, dense, dense]))
    expect(computeExtractionQuality(pages)).toBe('successful')
  })

  it('reports partial for a minority-scanned mixed document', () => {
    const pages = profilePages(doc([dense, dense, dense, '']))
    expect(computeExtractionQuality(pages)).toBe('partial')
  })

  it('reports ocr_required when most pages are likely scanned', () => {
    const pages = profilePages(doc(['', '', dense]))
    expect(computeExtractionQuality(pages)).toBe('ocr_required')
  })

  it('reports poor for uniformly thin (but present) text', () => {
    // Above the per-page scanned threshold (so no page is flagged scanned),
    // but well below a healthy average, e.g. a badly reflowed scan-to-text PDF.
    const thin = 'x'.repeat(LIKELY_SCANNED_PAGE_CHARS + 5)
    const pages = profilePages(doc([thin, thin, thin]))
    expect(pages.every((p) => !p.likelyScanned)).toBe(true)
    expect(computeExtractionQuality(pages)).toBe('poor')
  })
})
