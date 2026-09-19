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

describe('running headers with a joined printed page number', () => {
  // Mirrors a real thesis: the real heading, then even pages start with
  // "<n> BIBLIOGRAPHY" and odd pages with "BIBLIOGRAPHY <n>".
  const bibliography = docFrom(
    'Earlier body text.\n\nBibliography\n[1] First reference.',
    '146 BIBLIOGRAPHY\n[2] Second reference.',
    'BIBLIOGRAPHY 147\n[3] Third reference.',
    '148 BIBLIOGRAPHY\n[4] Fourth reference.',
    'BIBLIOGRAPHY 149\n[5] Fifth reference.',
    '150 BIBLIOGRAPHY\n[6] Sixth reference.',
  )

  it('does not turn "146 BIBLIOGRAPHY" into new sections', () => {
    const sections = detectSections(bibliography)
    expect(sections.map((s) => [s.title, s.sectionType])).toEqual([
      ['Front matter', 'other'],
      ['Bibliography', 'references'],
    ])
    expect(sections[1]).toMatchObject({ pageStart: 1, pageEnd: 6 })
  })

  it('keeps every reference entry and the ignored header lines in the text', () => {
    const [, bib] = detectSections(bibliography)
    for (const entry of ['[1]', '[2]', '[3]', '[4]', '[5]', '[6]']) {
      expect(bib.text).toContain(entry)
    }
    expect(bib.text).toContain('146 BIBLIOGRAPHY')
    expect(bib.text).toContain('BIBLIOGRAPHY 147')
  })

  it('handles the trailing page-number form on its own', () => {
    const doc = docFrom(
      'Bibliography\n[1] A.',
      'BIBLIOGRAPHY 146\n[2] B.',
      'BIBLIOGRAPHY 147\n[3] C.',
    )
    expect(titles(doc)).toEqual(['Bibliography'])
  })

  it('handles the References equivalents in the same way', () => {
    const doc = docFrom(
      'Conclusions\nWe conclude.',
      'References\n[1] A.',
      '147 REFERENCES\n[2] B.',
      'REFERENCES 148\n[3] C.',
      '149 REFERENCES\n[4] D.',
    )
    const sections = detectSections(doc)
    expect(sections.map((s) => s.title)).toEqual(['Conclusions', 'References'])
    expect(sections[1].text).toContain('[4]')
  })

  it('works for a footer as well as a header', () => {
    const doc = docFrom(
      'References\n[1] A.',
      '[2] B.\n[3] C.\n[4] D.\nREFERENCES 147',
      '[5] E.\n[6] F.\n[7] G.\n148 REFERENCES',
    )
    expect(titles(doc)).toEqual(['References'])
  })

  it('still matches when the numbered form is what first opened the section', () => {
    const doc = docFrom(
      'Conclusions\nWe conclude.',
      '10 REFERENCES\n[1] A.',
      'REFERENCES 11\n[2] B.',
      '12 REFERENCES\n[3] C.',
      'REFERENCES\n[4] D.',
    )
    expect(titles(doc)).toEqual(['Conclusions', '10 REFERENCES'])
  })

  it('treats two consecutive numbered headers as repeated running-header evidence', () => {
    // No section is open for this heading (a different heading opened in between),
    // but the same numbered header repeats on adjacent pages.
    const doc = docFrom(
      'Preliminaries\nText.',
      '20 REFERENCES\n[1] A.',
      '22 REFERENCES\n[2] B.',
    )
    expect(titles(doc)).toEqual(['Preliminaries', '20 REFERENCES'])
  })
})

describe('genuine numbered sections are not suppressed', () => {
  it('keeps sequential top-level numbered headings at the top of pages', () => {
    const doc = docFrom(
      '1 Introduction\nIntro.',
      '2 Related Work\nRelated.',
      '3 BERT\nModel.',
      '4 Experiments\nRuns.',
      '5 Conclusions\nDone.',
    )
    expect(titles(doc)).toEqual([
      '1 Introduction',
      '2 Related Work',
      '3 BERT',
      '4 Experiments',
      '5 Conclusions',
    ])
  })

  it('does not strip a section number that follows an unnumbered open section', () => {
    // "1 Introduction" is the next top-level number, so it is a real heading even
    // though "Introduction" is open.
    const doc = docFrom(
      'Introduction\nUnnumbered.',
      '1 Introduction\nNumbered.',
    )
    expect(titles(doc)).toEqual(['Introduction', '1 Introduction'])
  })

  it.each(['4.1 Introduction', '5.5 Conclusions', '6.4 Methodology'])(
    'never strips dotted numbering: %s',
    (heading) => {
      const bare = heading.replace(/^\d+\.\d+ /, '')
      const doc = docFrom(
        `${bare}\nUnnumbered text.`,
        `${heading}\nNumbered text.`,
      )
      expect(titles(doc)).toEqual([bare, heading])
    },
  )

  it('keeps distinct Appendix numbers separate', () => {
    const doc = docFrom('Appendix 1\nFirst.', 'Appendix 2\nSecond.')
    expect(titles(doc)).toEqual(['Appendix 1', 'Appendix 2'])
  })

  it('keeps the same generic title in different numbered chapters', () => {
    const doc = docFrom(
      '4.1 Introduction\nChapter four.',
      '146 4.1 Introduction\nStill four.',
      '5.1 Introduction\nChapter five.',
    )
    expect(titles(doc)).toEqual(['4.1 Introduction', '5.1 Introduction'])
  })

  it('does not suppress a page-numbered heading in the middle of a page', () => {
    // Outside the header/footer zone the number is never treated as a page number.
    const doc = docFrom(
      'Bibliography\n[1] A.',
      'l1\nl2\nl3\n\n146 BIBLIOGRAPHY\nl4\nl5\nl6\nl7\nl8',
    )
    expect(titles(doc)).toEqual(['Bibliography', '146 BIBLIOGRAPHY'])
  })
})

describe('page text and downstream stages are unaffected', () => {
  const doc = docFrom(
    'Front.\n\nBibliography\n[1] One.',
    '146 BIBLIOGRAPHY\n[2] Two.',
    'BIBLIOGRAPHY 147\n[3] Three.',
    '148 BIBLIOGRAPHY\n[4] Four.',
  )

  it('accounts for every character of the document', () => {
    const rebuilt = strip(
      detectSections(doc)
        .map((s) => (s.title === 'Front matter' ? '' : s.title) + s.text)
        .join(''),
    )
    expect(rebuilt).toBe(strip(doc.text))
  })

  it('chunks map back to section text with correct pages', () => {
    const sections = detectSections(doc)
    const chunks = chunkSections(doc, sections, {
      targetChars: 40,
      overlapChars: 5,
    })
    for (const chunk of chunks) {
      expect(chunk.text).toBe(
        sections[chunk.sectionPosition].text.slice(
          chunk.charStart,
          chunk.charEnd,
        ),
      )
    }
    const bib = sections.find((s) => s.title === 'Bibliography')!
    expect(bib).toMatchObject({ pageStart: 1, pageEnd: 4 })
  })
})
