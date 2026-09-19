import { describe, expect, it } from 'vitest'
import { chunkSections } from './chunker'
import { normalizeDocument } from './normalize'
import { detectSections } from './section-detector'

const docFrom = (...pages: string[]) =>
  normalizeDocument({
    pageCount: pages.length,
    pages: pages.map((text, i) => ({ pageNumber: i + 1, text })),
  })

const titles = (doc: ReturnType<typeof docFrom>) =>
  detectSections(doc).map((s) => s.title)

const strip = (s: string) => s.replace(/\s+/g, '')

describe('running headers repeated on consecutive pages', () => {
  it('does not reopen a section on every page it spans', () => {
    const doc = docFrom(
      'Front page text.\n\n4.1 Introduction\nIntro text one.',
      '4.1 Introduction\nMore intro text.',
      '4.1 Introduction\nEven more intro text.',
      '4.1 Introduction\nFinal intro text.',
    )
    const sections = detectSections(doc)
    expect(sections.map((s) => s.title)).toEqual([
      'Front matter',
      '4.1 Introduction',
    ])
    expect(sections[1]).toMatchObject({ pageStart: 1, pageEnd: 4 })
  })

  it('keeps the text of every page that carried an ignored header', () => {
    const sections = detectSections(
      docFrom(
        '4.5 Experimental Results\nPage one results.',
        '4.5 Experimental Results\nPage two results.',
        '4.5 Experimental Results\nPage three results.',
      ),
    )
    expect(sections).toHaveLength(1)
    for (const text of [
      'Page one results.',
      'Page two results.',
      'Page three results.',
    ]) {
      expect(sections[0].text).toContain(text)
    }
  })

  it('collapses a repeated REFERENCES header across bibliography pages', () => {
    const doc = docFrom(
      'Conclusions\nWe conclude.',
      'References\n[1] First reference.',
      'REFERENCES\n[2] Second reference.',
      'REFERENCES\n[3] Third reference.',
      'REFERENCES\n[4] Fourth reference.',
    )
    const sections = detectSections(doc)
    expect(sections.map((s) => s.title)).toEqual(['Conclusions', 'References'])
    for (const ref of ['[1]', '[2]', '[3]', '[4]']) {
      expect(sections[1].text).toContain(ref)
    }
    expect(sections[1]).toMatchObject({ pageStart: 2, pageEnd: 5 })
  })

  it('ignores a running header that follows a page-number line', () => {
    const doc = docFrom(
      'Introduction\nFirst page text.',
      '43\nIntroduction\nSecond page text.',
    )
    expect(titles(doc)).toEqual(['Introduction'])
  })

  it('ignores a running footer that repeats the open section', () => {
    const doc = docFrom(
      'Introduction\nFirst page text.',
      'Second page body.\nMore body.\nEven more body.\nIntroduction',
    )
    expect(titles(doc)).toEqual(['Introduction'])
  })

  it('ignores a header that names a section starting later on the same page', () => {
    // LaTeX-style marks: the page header shows the section that begins below.
    const sections = detectSections(
      docFrom(
        '4.1 Introduction\nText of the first section.',
        '4.5 Experimental Results\nTail of section 4.1.\n\nMore of 4.1.\n\n4.5 Experimental Results\nReal results body.',
        '4.5 Experimental Results\nResults continue.',
      ),
    )
    expect(sections.map((s) => s.title)).toEqual([
      '4.1 Introduction',
      '4.5 Experimental Results',
    ])
    // The header line and the rest of that page stay with the section that was open...
    expect(sections[0].text).toContain('Tail of section 4.1.')
    expect(sections[0].text).toContain('More of 4.1.')
    // ...and the real heading owns its own body, including the next page.
    expect(sections[1].text).toBe(
      'Real results body.\n\n4.5 Experimental Results\nResults continue.',
    )
    expect(sections[1]).toMatchObject({ pageStart: 2, pageEnd: 3 })
  })
})

describe('distinct sections keep distinct headings', () => {
  it('keeps the same generic title in different numbered chapters', () => {
    const doc = docFrom(
      '4.1 Introduction\nChapter four intro.',
      '4.1 Introduction\nChapter four intro continues.',
      '5.1 Introduction\nChapter five intro.',
      '5.1 Introduction\nChapter five intro continues.',
      '6.1 Introduction\nChapter six intro.',
    )
    const sections = detectSections(doc)
    expect(sections.map((s) => s.title)).toEqual([
      '4.1 Introduction',
      '5.1 Introduction',
      '6.1 Introduction',
    ])
    expect(sections[0].text).toContain('Chapter four intro continues.')
    expect(sections[1].text).toContain('Chapter five intro continues.')
    expect(sections[2].text).toBe('Chapter six intro.')
  })

  it('still starts a new section at the top of a page when it is genuinely different', () => {
    const sections = detectSections(
      docFrom(
        '4.1 Introduction\nIntro body.',
        '4.5 Experimental Results\nResults body.',
      ),
    )
    expect(sections.map((s) => s.title)).toEqual([
      '4.1 Introduction',
      '4.5 Experimental Results',
    ])
    expect(sections[1]).toMatchObject({ pageStart: 2, pageEnd: 2 })
  })

  it('keeps an identical heading in the middle of a page as a real new section', () => {
    // Unnumbered chapters both called "Introduction": not in a header/footer zone.
    const doc = docFrom(
      'Introduction\nl1\nl2\nl3\nl4\nl5\nl6',
      'l1\nl2\nl3\n\nIntroduction\nl4\nl5\nl6\nl7\nl8',
    )
    expect(titles(doc)).toEqual(['Introduction', 'Introduction'])
  })

  it('a genuine transition still works alongside running headers', () => {
    const doc = docFrom(
      'Introduction\nIntro body.',
      'Introduction\nMore intro body.',
      'Conclusion\nWe conclude.',
      'Conclusion\nStill concluding.',
      'References\n[1] Ref.',
      'REFERENCES\n[2] Ref.',
    )
    expect(titles(doc)).toEqual(['Introduction', 'Conclusion', 'References'])
  })
})

describe('no text is lost and downstream stages still work', () => {
  const doc = docFrom(
    'Front text.\n\n4.1 Introduction\nOne.',
    '4.1 Introduction\nTwo.',
    '4.5 Experimental Results\nThree.\n\n4.5 Experimental Results\nFour.',
    '4.5 Experimental Results\nFive.',
    'References\n[1] Six.',
    'REFERENCES\n[2] Seven.',
  )

  it('every character survives (ignored headers remain as body text)', () => {
    const sections = detectSections(doc)
    const rebuilt = strip(
      sections
        .map((s) => (s.title === 'Front matter' ? '' : s.title) + s.text)
        .join(''),
    )
    // Accepted headings become titles; ignored running headers stay in the text.
    // Either way every character of the document is accounted for, in order.
    expect(rebuilt).toBe(strip(doc.text))
  })

  it('chunks map back to their section text and pages', () => {
    const sections = detectSections(doc)
    const chunks = chunkSections(doc, sections, {
      targetChars: 60,
      overlapChars: 10,
    })
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.text).toBe(
        sections[chunk.sectionPosition].text.slice(
          chunk.charStart,
          chunk.charEnd,
        ),
      )
    }
    const refs = sections.find((s) => s.title === 'References')!
    expect(refs).toMatchObject({ pageStart: 5, pageEnd: 6 })
  })
})
