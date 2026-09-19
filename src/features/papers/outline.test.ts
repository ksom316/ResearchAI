import { describe, expect, it } from 'vitest'
import { buildOutline, formatPageRange } from './outline'
import type { PaperSection } from './types'

const section = (
  over: Partial<PaperSection> & { position: number },
): PaperSection => ({
  id: `s${over.position}`,
  title: `Section ${over.position}`,
  section_type: 'other',
  page_start: null,
  page_end: null,
  ...over,
})

describe('formatPageRange', () => {
  it.each([
    [1, 1, 'p. 1'],
    [3, 5, 'pp. 3–5'],
    [10, 12, 'pp. 10–12'],
    [7, null, 'p. 7'],
    [null, 7, 'p. 7'],
    [null, null, null],
  ])('(%s, %s) -> %s', (start, end, expected) => {
    expect(formatPageRange(start, end)).toBe(expected)
  })

  it('does not print a backwards range', () => {
    expect(formatPageRange(5, 3)).toBe('p. 5')
  })
})

describe('buildOutline', () => {
  it('orders by position regardless of input order', () => {
    const outline = buildOutline([
      section({ position: 2, title: 'C' }),
      section({ position: 0, title: 'A' }),
      section({ position: 1, title: 'B' }),
    ])
    expect(outline.map((i) => i.title)).toEqual(['A', 'B', 'C'])
  })

  it('does not mutate the input array', () => {
    const input = [section({ position: 1 }), section({ position: 0 })]
    buildOutline(input)
    expect(input.map((s) => s.position)).toEqual([1, 0])
  })

  it('formats page ranges', () => {
    const [a, b, c] = buildOutline([
      section({ position: 0, page_start: 1, page_end: 2 }),
      section({ position: 1, page_start: 3, page_end: 3 }),
      section({ position: 2 }),
    ])
    expect([a.pages, b.pages, c.pages]).toEqual(['pp. 1–2', 'p. 3', null])
  })

  it('labels semantic types but not generic "other" sections', () => {
    const [intro, bert, unknown] = buildOutline([
      section({
        position: 0,
        title: 'Overview',
        section_type: 'introduction',
      }),
      section({ position: 1, title: '3 BERT', section_type: 'other' }),
      section({ position: 2, title: 'Odd', section_type: 'not_a_known_type' }),
    ])
    expect(intro.typeLabel).toBe('Introduction')
    expect(bert.typeLabel).toBeNull()
    expect(unknown.typeLabel).toBeNull()
  })

  it('drops a type label that would only repeat the title', () => {
    const items = buildOutline([
      section({ position: 0, title: 'Abstract', section_type: 'abstract' }),
      section({ position: 1, title: 'REFERENCES', section_type: 'references' }),
      section({
        position: 2,
        title: 'Related Work',
        section_type: 'related_work',
      }),
      section({
        position: 3,
        title: '2 Related Work',
        section_type: 'related_work',
      }),
    ])
    // Section numbers are ignored when comparing, so "2 Related Work" is redundant too.
    expect(items.map((i) => i.typeLabel)).toEqual([null, null, null, null])
  })

  it('keeps a type label that adds information', () => {
    const [item] = buildOutline([
      section({
        position: 0,
        title: 'Experimental Results',
        section_type: 'results',
      }),
    ])
    expect(item.typeLabel).toBe('Results')
  })

  it('keeps long titles intact for the UI to wrap', () => {
    const title = 'A very long section title '.repeat(20).trim()
    expect(buildOutline([section({ position: 0, title })])[0].title).toBe(title)
  })

  it('returns an empty outline for no sections', () => {
    expect(buildOutline([])).toEqual([])
  })
})
