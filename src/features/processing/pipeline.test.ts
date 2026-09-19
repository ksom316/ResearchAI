import { describe, expect, it } from 'vitest'
import { ProcessingError } from './errors'
import type { PdfExtractor } from './extractor'
import { normalizeText } from './normalize'
import { buildPersistenceRows, processingSucceededUpdate } from './persistence'
import { processExtractedDocument, processPdf } from './pipeline'
import type { ExtractedDocument } from './types'

const sample: ExtractedDocument = {
  pageCount: 2,
  pages: [
    {
      pageNumber: 1,
      text: 'Abstract\nWe study things.\n\nIntroduction\nThings matter.',
    },
    { pageNumber: 2, text: 'Conclusion\nThings are good.' },
  ],
}

describe('normalizeText', () => {
  it('fixes line endings, ligatures, control characters and spacing', () => {
    const nul = String.fromCodePoint(0)
    const nbsp = String.fromCodePoint(0xa0)
    const fi = String.fromCodePoint(0xfb01)
    const raw = `a\r\nb${nul}${nbsp}  c${fi}\n\n\n\nd  `
    expect(normalizeText(raw)).toBe('a\nb cfi\n\nd')
  })
})

describe('processExtractedDocument', () => {
  it('runs normalize -> sections -> chunks', () => {
    const result = processExtractedDocument(sample)
    expect(result.pageCount).toBe(2)
    expect(result.sections.map((s) => s.title)).toEqual([
      'Abstract',
      'Introduction',
      'Conclusion',
    ])
    expect(result.chunks.map((c) => c.text)).toEqual([
      'We study things.',
      'Things matter.',
      'Things are good.',
    ])
  })

  it('throws no_extractable_text for text-less documents', () => {
    const blank: ExtractedDocument = {
      pageCount: 1,
      pages: [{ pageNumber: 1, text: ' \n ' }],
    }
    expect(() => processExtractedDocument(blank)).toThrowError(ProcessingError)
  })
})

describe('processPdf', () => {
  it('returns ok with a processed document', async () => {
    const extractor: PdfExtractor = { extract: async () => sample }
    const outcome = await processPdf(new Uint8Array([1]), extractor)
    expect(outcome.ok).toBe(true)
  })

  it('maps ProcessingError to a failure with its safe message', async () => {
    const extractor: PdfExtractor = {
      extract: async () => {
        throw new ProcessingError(
          'encrypted_pdf',
          'The PDF is password-protected.',
        )
      },
    }
    expect(await processPdf(new Uint8Array(), extractor)).toEqual({
      ok: false,
      error: {
        code: 'encrypted_pdf',
        message: 'The PDF is password-protected.',
      },
    })
  })

  it('never leaks unexpected error messages', async () => {
    const extractor: PdfExtractor = {
      extract: async () => {
        throw new Error('ENOENT /secret/internal/path')
      },
    }
    const outcome = await processPdf(new Uint8Array(), extractor)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('extraction_failed')
      expect(outcome.error.message).not.toContain('secret')
    }
  })
})

describe('buildPersistenceRows', () => {
  it('links chunks to their sections and stamps ownership', () => {
    const document = processExtractedDocument(sample)
    let n = 0
    const rows = buildPersistenceRows(
      { paperId: 'paper', userId: 'user' },
      document,
      () => `id-${n++}`,
    )
    expect(rows.sections).toHaveLength(3)
    expect(rows.chunks).toHaveLength(3)
    for (const row of [...rows.sections, ...rows.chunks]) {
      expect(row).toMatchObject({ paper_id: 'paper', user_id: 'user' })
    }
    expect(rows.chunks[1].section_id).toBe(rows.sections[1].id)
  })

  it('produces a ready update that satisfies the DB consistency check', () => {
    const update = processingSucceededUpdate(processExtractedDocument(sample))
    expect(update.status).toBe('ready')
    expect(update.page_count).toBe(2)
    expect(update.processing_completed_at).toBeTruthy()
    expect(update.processing_error).toBeNull()
  })
})
