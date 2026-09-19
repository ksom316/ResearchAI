import { describe, expect, it } from 'vitest'
import { normalizeDocument } from './normalize'
import { detectSections, parseTopLevelNumbering } from './section-detector'

const docFrom = (...pages: string[]) =>
  normalizeDocument({
    pageCount: pages.length,
    pages: pages.map((text, i) => ({ pageNumber: i + 1, text })),
  })

const titles = (doc: ReturnType<typeof docFrom>) =>
  detectSections(doc).map((s) => [s.title, s.sectionType])

const ieee = [
  'Title and authors here',
  'I. INTRODUCTION\nWe study figures.',
  'II. OVERVIEW OF FIGURE CLASSIFICATION PROBLEM\nA figure is an image.',
  'III. RELATED WORK\nPrior work exists.',
  'IV. DATASETS\nSeveral datasets exist.',
  'V. FUTURE DIRECTIONS\nMuch remains.',
  'VI. CONCLUSION\nWe conclude.',
  'REFERENCES\n[1] A. Author, A paper.',
].join('\n\n')

describe('structural Roman-numeral headings', () => {
  it('detects sequential Roman headings I through VI, with semantic types where known', () => {
    expect(titles(docFrom(ieee))).toEqual([
      ['Front matter', 'other'],
      ['I. INTRODUCTION', 'introduction'],
      ['II. OVERVIEW OF FIGURE CLASSIFICATION PROBLEM', 'other'],
      ['III. RELATED WORK', 'related_work'],
      ['IV. DATASETS', 'other'],
      ['V. FUTURE DIRECTIONS', 'other'],
      ['VI. CONCLUSION', 'conclusion'],
      ['REFERENCES', 'references'],
    ])
  })

  it('types an unknown Roman heading as other and a known one semantically', () => {
    const sections = detectSections(
      docFrom(
        'I. INTRODUCTION\nText.\n\nII. SYSTEM DESIGN\nText.\n\nIII. RESULTS\nText.',
      ),
    )
    expect(sections.map((s) => s.sectionType)).toEqual([
      'introduction',
      'other',
      'results',
    ])
  })

  it('keeps section bodies and page provenance across pages', () => {
    const sections = detectSections(
      docFrom(
        'I. INTRODUCTION\nPage one text.\n\nII. BACKGROUND STUDY\nStart of two.',
        'More of section two on page two.\n\nIII. METHOD DETAILS\nMethod text.',
      ),
    )
    expect(sections.map((s) => s.title)).toEqual([
      'I. INTRODUCTION',
      'II. BACKGROUND STUDY',
      'III. METHOD DETAILS',
    ])
    expect(sections[1]).toMatchObject({ pageStart: 1, pageEnd: 2 })
    expect(sections[1].text).toBe(
      'Start of two.\n\nMore of section two on page two.',
    )
    expect(sections[2]).toMatchObject({ pageStart: 2, pageEnd: 2 })
  })

  it('accepts Title Case as well as ALL CAPS Roman headings', () => {
    expect(
      titles(docFrom('I. Introduction\nText.\n\nII. Data Collection\nText.')),
    ).toEqual([
      ['I. Introduction', 'introduction'],
      ['II. Data Collection', 'other'],
    ])
  })

  it('supports numerals up to XX', () => {
    const numerals = [
      'I',
      'II',
      'III',
      'IV',
      'V',
      'VI',
      'VII',
      'VIII',
      'IX',
      'X',
      'XI',
      'XII',
      'XIII',
      'XIV',
      'XV',
      'XVI',
      'XVII',
      'XVIII',
      'XIX',
      'XX',
    ]
    const text = numerals
      .map((n) => `${n}. SECTION NUMBER ${n}\nBody.`)
      .join('\n\n')
    expect(detectSections(docFrom(text))).toHaveLength(20)
  })

  it('a known Roman heading resyncs the sequence', () => {
    expect(
      titles(
        docFrom(
          'I. INTRODUCTION\nText.\n\nV. CONCLUSION\nText.\n\nVI. FUTURE DIRECTIONS\nText.',
        ),
      ),
    ).toEqual([
      ['I. INTRODUCTION', 'introduction'],
      ['V. CONCLUSION', 'conclusion'],
      ['VI. FUTURE DIRECTIONS', 'other'],
    ])
  })
})

describe('Roman headings out of sequence are rejected', () => {
  const start = 'I. INTRODUCTION\nText.\n\n'

  it.each([
    ['skipping ahead', 'IV. DATASETS'],
    ['repeating a number', 'I. ANOTHER HEADING'],
    ['going backwards after II', 'I. LATE HEADING'],
  ])('%s', (_name, line) => {
    expect(titles(docFrom(`${start}${line}\nBody.`))).toEqual([
      ['I. INTRODUCTION', 'introduction'],
    ])
  })

  it('cannot start the sequence from a random numeral', () => {
    expect(
      detectSections(
        docFrom('Front matter.\n\nIII. SOMETHING HERE\nBody text.'),
      ).map((s) => s.title),
    ).toEqual(['Full text'])
  })
})

describe('ordinary text with Roman numerals is not promoted', () => {
  const start = 'I. INTRODUCTION\nText.\n\n'

  it.each([
    ['citation-style reference', '[IV] A. Author, A paper.'],
    ['prose', 'II. is the second stage of the process.'],
    ['sentence-style list item', 'II. Choose the best option available'],
    ['table cell row', 'II. 0.5 0.3 0.9'],
    ['equation', 'II. = I + V'],
    ['figure label', 'Fig. II shows the results'],
    ['title with a comma', 'II. Data, Models and Metrics'],
    ['item ending in a period', 'II. Tokenize the input.'],
    ['title with too few letters', 'II. A'],
    [
      'too many words',
      'II. A Very Long Numbered Line That Is Clearly Not A Heading',
    ],
  ])('rejects a %s', (_name, line) => {
    expect(titles(docFrom(`${start}${line}\nSome body text follows.`))).toEqual(
      [['I. INTRODUCTION', 'introduction']],
    )
  })

  it('requires a blank line before an unknown Roman heading', () => {
    expect(
      titles(docFrom('I. INTRODUCTION\nText here.\nII. SYSTEM DESIGN\nBody.')),
    ).toEqual([['I. INTRODUCTION', 'introduction']])
  })

  it('never loses text when rejecting candidates', () => {
    const [section] = detectSections(
      docFrom(`${start}II. 0.5 0.3 0.9\n\n[IV] Ref.\n\nEnd.`),
    )
    expect(section.text).toContain('II. 0.5 0.3 0.9')
    expect(section.text).toContain('[IV] Ref.')
  })
})

describe('subsection styles are never top-level sections', () => {
  it.each([
    'A. Table',
    'B. Photo',
    'C. Diagram',
    'D. Map',
    'E. Plot',
    '1) Traditional Approaches',
    '2) Deep Learning Approaches',
    'A) Table',
  ])('rejects %j inside a Roman-numbered paper', (line) => {
    const doc = docFrom(
      `I. INTRODUCTION\nText.\n\nII. OVERVIEW OF THE PROBLEM\nText.\n\n${line}\nBody.\n\nIII. RELATED WORK\nText.`,
    )
    expect(titles(doc).map(([t]) => t)).toEqual([
      'I. INTRODUCTION',
      'II. OVERVIEW OF THE PROBLEM',
      'III. RELATED WORK',
    ])
  })

  it('keeps the real subsection text inside its parent section', () => {
    const [, second] = detectSections(
      docFrom(
        'I. INTRODUCTION\nText.\n\nII. OVERVIEW OF THE PROBLEM\nIntro.\n\nA. Table\nTables.\n\nB. Photo\nPhotos.',
      ),
    )
    expect(second.text).toContain('A. Table')
    expect(second.text).toContain('B. Photo')
  })

  it('does not treat a lettered subsection like "I." as a Roman section in an Arabic paper', () => {
    const doc = docFrom(
      '1 Introduction\nText.\n\n2 Methods Summary\nText.\n\nI. Miscellaneous Notes\nLettered subsection.',
    )
    expect(titles(doc).map(([t]) => t)).toEqual([
      '1 Introduction',
      '2 Methods Summary',
    ])
  })
})

describe('Roman and Arabic numbering stay separate', () => {
  it('Arabic-numbered papers are unaffected by the Roman rule', () => {
    const doc = docFrom(
      '1 Introduction\nText.\n\n2 Related Work\nText.\n\n3 BERT\nText.\n\n4 Experiments\nText.\n\n5 Ablation Studies\nText.\n\n6 Conclusion\nText.',
    )
    expect(titles(doc)).toEqual([
      ['1 Introduction', 'introduction'],
      ['2 Related Work', 'related_work'],
      ['3 BERT', 'other'],
      ['4 Experiments', 'other'],
      ['5 Ablation Studies', 'other'],
      ['6 Conclusion', 'conclusion'],
    ])
  })

  it('Roman papers do not start an Arabic sequence from list items', () => {
    const doc = docFrom(
      'I. INTRODUCTION\nText.\n\nII. SYSTEM DESIGN\nText.\n\n1. Data Cleaning\nA list item.\n\n2. Model Training\nAnother.',
    )
    expect(titles(doc).map(([t]) => t)).toEqual([
      'I. INTRODUCTION',
      'II. SYSTEM DESIGN',
    ])
  })
})

describe('parseTopLevelNumbering', () => {
  it.each([
    ['3 BERT', 'arabic', 3],
    ['III. RELATED WORK', 'roman', 3],
    ['XX. LAST', 'roman', 20],
    ['IV. DATASETS', 'roman', 4],
  ])('%j -> %s %s', (line, kind, value) => {
    expect(parseTopLevelNumbering(line)).toMatchObject({ kind, value })
  })

  it.each([
    'A. Table',
    'C. Diagram',
    'XXI. TOO HIGH',
    'XL. OUT OF RANGE',
    'IIII. INVALID',
    'VX. INVALID',
    '1) Traditional Approaches',
    '3.1 Methods',
    'iv. lowercase',
    '[IV] Reference',
    'IV Datasets',
  ])('%j -> null', (line) => {
    expect(parseTopLevelNumbering(line)).toBeNull()
  })
})
