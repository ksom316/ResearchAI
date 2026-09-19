import { describe, expect, it } from 'vitest'
import { normalizeDocument } from './normalize'
import {
  detectSections,
  looksLikeHeadingTitle,
  topLevelNumber,
} from './section-detector'

const docFrom = (...pages: string[]) =>
  normalizeDocument({
    pageCount: pages.length,
    pages: pages.map((text, i) => ({ pageNumber: i + 1, text })),
  })

const titles = (doc: ReturnType<typeof docFrom>) =>
  detectSections(doc).map((s) => [s.title, s.sectionType])

describe('structural numbered headings (titles outside the vocabulary)', () => {
  it('detects unknown top-level headings as section_type=other, in sequence', () => {
    const doc = docFrom(
      [
        'Abstract\nWe do things.',
        '1 Introduction\nIntro text here.',
        '2 Related Work\nPrior work here.',
        '3 BERT\nWe describe the model.',
        '4 Experiments\nWe ran experiments.',
        '5 Ablation Studies\nWe removed parts.',
        '6 Conclusion\nWe conclude.',
      ].join('\n\n'),
    )
    expect(titles(doc)).toEqual([
      ['Abstract', 'abstract'],
      ['1 Introduction', 'introduction'],
      ['2 Related Work', 'related_work'],
      ['3 BERT', 'other'],
      ['4 Experiments', 'other'],
      ['5 Ablation Studies', 'other'],
      ['6 Conclusion', 'conclusion'],
    ])
  })

  it('keeps each section body and page provenance across page breaks', () => {
    const doc = docFrom(
      '1 Introduction\nIntro on page one.\n\n2 Related Work\nRelated text.',
      'More related text on page two.\n\n3 Method Overview\nMethod text.',
      'Still method text on page three.',
    )
    const sections = detectSections(doc)
    expect(sections.map((s) => s.title)).toEqual([
      '1 Introduction',
      '2 Related Work',
      '3 Method Overview',
    ])
    expect(sections[1]).toMatchObject({ pageStart: 1, pageEnd: 2 })
    expect(sections[2]).toMatchObject({
      pageStart: 2,
      pageEnd: 3,
      sectionType: 'other',
    })
    expect(sections[2].text).toBe(
      'Method text.\n\nStill method text on page three.',
    )
  })

  it('accepts multi-word, all-caps and small-word titles', () => {
    const doc = docFrom(
      '1 Introduction\nText.\n\n2 EXPERIMENTAL SETUP\nText.\n\n3 Analysis of Results and Limits\nText.',
    )
    expect(titles(doc).map(([t]) => t)).toEqual([
      '1 Introduction',
      '2 EXPERIMENTAL SETUP',
      '3 Analysis of Results and Limits',
    ])
  })

  it('accepts "3. Title" with a period after the number', () => {
    const doc = docFrom('1. Introduction\nText.\n\n2. Data Collection\nText.')
    expect(titles(doc)).toEqual([
      ['1. Introduction', 'introduction'],
      ['2. Data Collection', 'other'],
    ])
  })

  it('does not require a preceding heading to be a known one', () => {
    const doc = docFrom('1 Motivation\nText.\n\n2 Approach Summary\nText.')
    expect(titles(doc)).toEqual([
      ['1 Motivation', 'other'],
      ['2 Approach Summary', 'other'],
    ])
  })
})

describe('ordinary numbered text is not promoted to a section', () => {
  const intro = '1 Introduction\nWe start here.\n\n'

  it.each([
    ['table row', '3 768 12 5.84 77.9 79.8 88.4'],
    ['wrapped sentence', '2 random restarts using those hyperparameters.'],
    [
      'list item with a colon and lowercase words',
      '2. Question: Does it converge',
    ],
    ['sentence-style list item', '2. Use a smaller batch size for training'],
    ['math or bracket text', '2 E[SEP]... EN E1 ... EM'],
    ['item ending in a period', '2. Tokenize the input.'],
    ['title with a comma', '2 Data, Models and Metrics'],
    [
      'too many words',
      '2 A Very Long Numbered Line That Is Clearly Not A Heading',
    ],
    ['number followed by a number', '2 2019 Results'],
  ])('rejects a %s even when the number is next in sequence', (_name, line) => {
    const doc = docFrom(`${intro}${line}\nSome body text follows.`)
    expect(titles(doc)).toEqual([['1 Introduction', 'introduction']])
  })

  it('requires the next number in sequence', () => {
    // "5 Something" right after section 1 is not section 2.
    const doc = docFrom(`${intro}5 Something Else\nBody.`)
    expect(titles(doc)).toEqual([['1 Introduction', 'introduction']])
    // ...and a repeated number is not a new section either.
    const repeated = docFrom(`${intro}1 Another Heading\nBody.`)
    expect(titles(repeated)).toEqual([['1 Introduction', 'introduction']])
  })

  it('requires a blank line before an unknown heading', () => {
    const doc = docFrom(
      '1 Introduction\nWe start here.\n2 Method Overview\nBody.',
    )
    expect(titles(doc)).toEqual([['1 Introduction', 'introduction']])
  })

  it('does not treat subsection numbers as top-level sections', () => {
    const doc = docFrom(
      '1 Introduction\nText.\n\n2 Related Work\nText.\n\n2.1 Pre-training Tasks\nText.\n\n2.2 Fine Tuning\nText.',
    )
    expect(titles(doc)).toEqual([
      ['1 Introduction', 'introduction'],
      ['2 Related Work', 'related_work'],
    ])
  })

  it('does not start numbering from a random number', () => {
    // No "1" heading yet, so "3 Something" cannot begin the sequence.
    const doc = docFrom('Some front matter.\n\n3 Something Here\nBody text.')
    expect(detectSections(doc).map((s) => s.title)).toEqual(['Full text'])
  })

  it('keeps a numbered list inside its section', () => {
    const doc = docFrom(
      '1 Introduction\nWe make three points:\n\n1. Question: does it work\n\n2. Question: does it scale\n\n3. Question: does it help',
    )
    expect(detectSections(doc)).toHaveLength(1)
  })

  it('never loses text when rejecting candidates', () => {
    const doc = docFrom(
      `${intro}3 768 12 5.84\n\n2. Tokenize the input.\n\nEnd.`,
    )
    const [section] = detectSections(doc).slice(0, 1)
    expect(section.text).toContain('3 768 12 5.84')
    expect(section.text).toContain('2. Tokenize the input.')
  })
})

describe('known headings still resync the sequence', () => {
  it('a known numbered heading sets the number that unknown headings must follow', () => {
    const doc = docFrom(
      '1 Introduction\nText.\n\n4 Conclusion\nText.\n\n5 Future Directions Ahead\nText.',
    )
    expect(titles(doc)).toEqual([
      ['1 Introduction', 'introduction'],
      ['4 Conclusion', 'conclusion'],
      ['5 Future Directions Ahead', 'other'],
    ])
  })

  it('unnumbered known headings are unaffected', () => {
    const doc = docFrom('Abstract\nText.\n\nReferences\n[1] Ref.')
    expect(titles(doc)).toEqual([
      ['Abstract', 'abstract'],
      ['References', 'references'],
    ])
  })
})

describe('helpers', () => {
  it.each([
    ['3 BERT', 3],
    ['3. BERT', 3],
    ['12 Results', 12],
    ['3.1 Methods', null],
    ['BERT', null],
    ['100 Things', null],
  ])('topLevelNumber(%j) = %s', (line, expected) => {
    expect(topLevelNumber(line)).toBe(expected)
  })

  it.each([
    ['BERT', true],
    ['Ablation Studies', true],
    ['Analysis of Results', true],
    ['Pre-training BERT', true],
    ['MODEL DETAILS', true],
    ['lowercase start', false],
    ['Ends with period.', false],
    ['With, comma', false],
    ['768 12 layers', false],
    ['of Start', false],
    ['', false],
  ])('looksLikeHeadingTitle(%j) = %s', (title, expected) => {
    expect(looksLikeHeadingTitle(title)).toBe(expected)
  })
})
