import { describe, expect, it } from 'vitest'
import { ProcessingError } from '../src/features/processing/errors'
import { processPdf } from '../src/features/processing/pipeline'
import { PdfJsExtractor, mapPdfJsError } from './pdf-extractor'
import { buildPdf } from './test-pdf'

describe('PdfJsExtractor', () => {
  const extractor = new PdfJsExtractor()

  it('extracts page-level text with stable page numbers', async () => {
    const pdf = buildPdf([
      ['Abstract', 'We study widgets in depth.'],
      ['1. Introduction', 'Widgets matter a great deal.'],
    ])
    const doc = await extractor.extract(pdf)
    expect(doc.pageCount).toBe(2)
    expect(doc.pages.map((p) => p.pageNumber)).toEqual([1, 2])
    expect(doc.pages[0].text).toBe('Abstract\nWe study widgets in depth.')
    expect(doc.pages[1].text).toBe(
      '1. Introduction\nWidgets matter a great deal.',
    )
  })

  it('returns an empty string for pages without text, keeping numbering', async () => {
    const doc = await extractor.extract(
      buildPdf([['Only page one has text'], [], ['Page three']]),
    )
    expect(doc.pages.map((p) => [p.pageNumber, p.text])).toEqual([
      [1, 'Only page one has text'],
      [2, ''],
      [3, 'Page three'],
    ])
  })

  it('does not modify the caller’s buffer', async () => {
    const pdf = buildPdf([['Hello world, this is text.']])
    const copy = new Uint8Array(pdf)
    await extractor.extract(pdf)
    expect(pdf).toEqual(copy)
  })

  it('rejects unreadable data as invalid_pdf', async () => {
    const garbage = new TextEncoder().encode(
      '%PDF-1.4 this is not really a pdf',
    )
    await expect(extractor.extract(garbage)).rejects.toMatchObject({
      code: 'invalid_pdf',
    })
  })

  it('stops with a timeout error once its deadline has passed', async () => {
    const slow = new PdfJsExtractor({ timeoutMs: -1 })
    await expect(slow.extract(buildPdf([['text']]))).rejects.toMatchObject({
      code: 'timeout',
    })
  })

  it('feeds the Phase 3A pipeline end to end', async () => {
    const pdf = buildPdf([
      ['Abstract', 'We study widgets and how they behave under load.'],
      [
        '1. Introduction',
        'Widgets matter because everyone uses widgets daily.',
      ],
    ])
    const outcome = await processPdf(pdf, extractor)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.document.pageCount).toBe(2)
      expect(outcome.document.sections.map((s) => s.title)).toEqual([
        'Abstract',
        '1. Introduction',
      ])
      expect(outcome.document.sections[1].pageStart).toBe(2)
    }
  })

  it('extracts a two-column academic page (BERT-style) without dropping either column', async () => {
    const left = (n: number) => 700 - n * 14
    const pdf = buildPdf([
      {
        lines: [
          { text: 'Abstract', x: 72, y: left(0) },
          { text: 'We introduce a new language', x: 72, y: left(1) },
          { text: 'representation model called BERT.', x: 72, y: left(2) },
          { text: '1 Introduction', x: 330, y: left(0) },
          { text: 'Language model pre-training has', x: 330, y: left(1) },
          { text: 'been shown to be effective.', x: 330, y: left(2) },
        ],
      },
    ])
    const doc = await extractor.extract(pdf)
    const text = doc.pages[0].text
    for (const phrase of [
      'Abstract',
      'representation model called BERT.',
      '1 Introduction',
      'been shown to be effective.',
    ]) {
      expect(text).toContain(phrase)
    }
    const outcome = await processPdf(pdf, extractor)
    expect(outcome.ok).toBe(true)
  })

  it('reports an image-only (scanned) PDF as no_extractable_text without crashing', async () => {
    const scan = buildPdf([{ image: true }, { image: true }])
    const doc = await extractor.extract(scan)
    expect(doc.pageCount).toBe(2)
    expect(doc.pages.map((p) => p.text)).toEqual(['', ''])
    expect(await processPdf(scan, extractor)).toMatchObject({
      ok: false,
      error: { code: 'no_extractable_text' },
    })
  })

  it('reports a PDF with no meaningful text as no_extractable_text', async () => {
    const outcome = await processPdf(buildPdf([[], ['1']]), extractor)
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: 'no_extractable_text' },
    })
  })
})

describe('mapPdfJsError', () => {
  it.each([
    ['PasswordException', 'encrypted_pdf'],
    ['InvalidPDFException', 'invalid_pdf'],
    ['MissingPDFException', 'invalid_pdf'],
    ['FormatError', 'invalid_pdf'],
    ['SomethingElse', 'extraction_failed'],
  ])('maps %s to %s', (name, code) => {
    const mapped = mapPdfJsError({
      name,
      message: 'internal detail /secret/path',
    })
    expect(mapped).toBeInstanceOf(ProcessingError)
    expect(mapped.code).toBe(code)
    expect(mapped.message).not.toContain('secret')
  })

  it('passes ProcessingError through and handles non-objects', () => {
    const own = new ProcessingError('timeout', 'x')
    expect(mapPdfJsError(own)).toBe(own)
    expect(mapPdfJsError('boom').code).toBe('extraction_failed')
    expect(mapPdfJsError(null).code).toBe('extraction_failed')
  })
})
