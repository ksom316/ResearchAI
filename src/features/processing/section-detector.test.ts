import { describe, expect, it } from 'vitest'
import { normalizeDocument } from './normalize'
import { detectSections, matchHeading } from './section-detector'

const docFrom = (...pages: string[]) =>
  normalizeDocument({
    pageCount: pages.length,
    pages: pages.map((text, i) => ({ pageNumber: i + 1, text })),
  })

describe('matchHeading', () => {
  it.each([
    ['Abstract', 'abstract'],
    ['ABSTRACT', 'abstract'],
    ['1. Introduction', 'introduction'],
    ['1 Introduction', 'introduction'],
    ['I. INTRODUCTION', 'introduction'],
    ['2. Background', 'background'],
    ['2. Related Work', 'related_work'],
    ['Literature Review', 'related_work'],
    ['3 Methodology', 'methods'],
    ['3.1 Methods', 'methods'],
    ['Materials and Methods', 'methods'],
    ['4. Results', 'results'],
    ['Results and Discussion', 'results'],
    ['5. Discussion', 'discussion'],
    ['6. Conclusion', 'conclusion'],
    ['Conclusions', 'conclusion'],
    ['Conclusion and Future Work', 'conclusion'],
    ['Limitations', 'limitations'],
    ['References:', 'references'],
    ['Bibliography', 'references'],
    ['Acknowledgements', 'acknowledgments'],
    ['Appendix A', 'appendix'],
  ])('recognizes %j', (line, type) => {
    expect(matchHeading(line)).toBe(type)
  })

  it.each([
    'Introduction to graph neural networks',
    'The results of this study are clear.',
    'We discuss the limitations of this approach in Section 5',
    'See references',
    '',
    '   ',
    'Results '.repeat(20),
    '1.',
  ])('does not treat %j as a heading', (line) => {
    expect(matchHeading(line)).toBeNull()
  })
})

describe('detectSections', () => {
  it('splits a typical paper in order, keeping heading text as titles', () => {
    const doc = docFrom(
      'Deep Learning for Widgets\nJane Doe\n\nAbstract\nWe study widgets.\n\n1. Introduction\nWidgets matter.',
      '2. Related Work\nOthers studied widgets.\n\n3. Methods\nWe built one.\n\nReferences\n[1] Smith 2020.',
    )
    const sections = detectSections(doc)

    expect(sections.map((s) => [s.title, s.sectionType])).toEqual([
      ['Front matter', 'other'],
      ['Abstract', 'abstract'],
      ['1. Introduction', 'introduction'],
      ['2. Related Work', 'related_work'],
      ['3. Methods', 'methods'],
      ['References', 'references'],
    ])
    expect(sections.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5])
    expect(sections[0].text).toBe('Deep Learning for Widgets\nJane Doe')
    expect(sections[1].text).toBe('We study widgets.')
    expect(sections[5].text).toBe('[1] Smith 2020.')
  })

  it('falls back to one generic section when no headings are found', () => {
    const sections = detectSections(docFrom('Just some prose.\n\nMore prose.'))
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({
      title: 'Full text',
      sectionType: 'other',
      position: 0,
      text: 'Just some prose.\n\nMore prose.',
    })
  })

  it('does not invent a front-matter section when the text starts with a heading', () => {
    const sections = detectSections(docFrom('Abstract\nHello.'))
    expect(sections.map((s) => s.title)).toEqual(['Abstract'])
  })

  it('keeps unrecognized headings inside the preceding section', () => {
    const sections = detectSections(
      docFrom('Introduction\nIntro text.\n\nOur Novel Architecture\nDetails.'),
    )
    expect(sections).toHaveLength(1)
    expect(sections[0].text).toBe(
      'Intro text.\n\nOur Novel Architecture\nDetails.',
    )
  })

  it('keeps a heading with no body as an empty section instead of dropping it', () => {
    const sections = detectSections(docFrom('Abstract\nIntroduction\nBody.'))
    expect(sections.map((s) => [s.title, s.text])).toEqual([
      ['Abstract', ''],
      ['Introduction', 'Body.'],
    ])
  })

  it('returns no sections for empty or whitespace-only documents', () => {
    expect(detectSections(docFrom(''))).toEqual([])
    expect(detectSections(docFrom('  \n\n  ', '\n'))).toEqual([])
  })

  it('records page ranges from the original page numbers', () => {
    const sections = detectSections(
      docFrom(
        'Introduction\nPage one text.',
        'Still introduction on page two.\n\nMethods\nPage two methods.',
      ),
    )
    expect(sections[0]).toMatchObject({ pageStart: 1, pageEnd: 2 })
    expect(sections[1]).toMatchObject({ pageStart: 2, pageEnd: 2 })
  })

  it('accounts for every non-heading character of the document', () => {
    const doc = docFrom(
      'Title line\n\nAbstract\nA b c.\n\nIntroduction\nD e f.\n\nSome Custom Heading\ng h i.',
    )
    const sections = detectSections(doc)
    const strip = (s: string) => s.replace(/\s+/g, '')
    // "Front matter" is a synthetic title, not text from the document.
    const kept = strip(
      sections
        .map((s) => (s.title === 'Front matter' ? '' : s.title) + s.text)
        .join(''),
    )
    // Every character survives, in order (headings re-attached to their bodies).
    expect(kept).toBe(strip(doc.text))
  })
})
