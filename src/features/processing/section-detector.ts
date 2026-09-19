import { pageAt } from './normalize'
import type { DocumentSection, NormalizedDocument, SectionType } from './types'

/**
 * Conservative, deterministic heading detection for academic papers.
 *
 * Two kinds of line are recognized as headings, both only when the WHOLE line is
 * the heading:
 *
 * 1. Known headings: the line (minus an optional number prefix such as "2.",
 *    "3.1" or "II." and a trailing colon) is one of a fixed vocabulary
 *    (Abstract, Introduction, Related Work, ...). They get a semantic type.
 *
 * 2. Structural numbered headings: a top-level numbered heading whose title is
 *    NOT in the vocabulary (e.g. "3 BERT", "4 Experiments"), typed 'other'.
 *    Because "3 something" also matches table rows, list items and wrapped
 *    sentences, ALL of these must hold:
 *      - it is a plain integer number (1-99), not "3.1"; subsections stay in
 *        their parent section;
 *      - it is the next top-level number in sequence: exactly one more than the
 *        previous top-level heading (numbered known headings count too; the
 *        first must be "1");
 *      - the title looks like a heading: 1-8 words, each capitalized (short
 *        function words like "of" and "and" excepted), no sentence punctuation,
 *        no digits-first tokens, at most 60 characters;
 *      - the line is preceded by a blank line (paragraph gap) or starts a page.
 *
 * Anything else, such as "Introduction to graph neural networks" or a sentence
 * that merely mentions "results", never matches and stays in the previous section.
 */

const MAX_HEADING_LENGTH = 60

const NUMBER_PREFIX = /^(?:\d+(?:\.\d+)*\.?|[IVXL]+\.)\s+/

const VOCABULARY: readonly (readonly [SectionType, RegExp])[] = [
  ['abstract', /^abstract$/],
  ['introduction', /^introduction$/],
  [
    'related_work',
    /^(?:related (?:work|works|research)|literature review|review of (?:the )?literature|background and related work|related work and background)$/,
  ],
  ['background', /^(?:background(?: and motivation)?|preliminaries)$/],
  [
    'methods',
    /^(?:methods?|methodology|materials and methods|methods and materials|research (?:methods?|methodology))$/,
  ],
  [
    'results',
    /^(?:results?|findings|experimental results|results and (?:analysis|discussion))$/,
  ],
  ['discussion', /^discussions?$/],
  [
    'limitations',
    /^(?:limitations?|limitations and future (?:work|directions))$/,
  ],
  [
    'conclusion',
    /^(?:conclusions?|concluding remarks|conclusions? and future (?:work|directions))$/,
  ],
  ['references', /^(?:references|bibliography|works cited)$/],
  ['acknowledgments', /^acknowledge?ments?$/],
  ['appendix', /^(?:appendix(?: [a-z0-9]+)?|appendices)$/],
]

/** Returns the section type if `line` is a recognized heading, otherwise null. */
export function matchHeading(line: string): SectionType | null {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.length > MAX_HEADING_LENGTH) return null

  const name = trimmed
    .replace(NUMBER_PREFIX, '')
    .replace(/[:.]$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (name === '') return null

  for (const [type, pattern] of VOCABULARY) {
    if (pattern.test(name)) return type
  }
  return null
}

const TOP_LEVEL_NUMBER = /^(\d{1,2})\.?\s+(\S.*)$/

const MAX_TITLE_WORDS = 8

/** Words allowed to be lowercase inside a title-case heading. */
const SMALL_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'in',
  'on',
  'for',
  'to',
  'with',
  'by',
  'at',
  'or',
  'vs',
  'via',
  'from',
  'as',
  'into',
  'over',
  'per',
])

/** Letters, digits, spaces and light punctuation only: no sentence or math symbols. */
const TITLE_CHARS = /^[\p{L}\p{N} \-–&'’()/+]+$/u

/** The plain top-level number ("3" in "3 BERT" or "3. BERT"), or null ("3.1 X" -> null). */
export function topLevelNumber(line: string): number | null {
  const match = TOP_LEVEL_NUMBER.exec(line.trim())
  return match ? Number(match[1]) : null
}

/** True if `title` (the text after the number) is shaped like a section heading. */
export function looksLikeHeadingTitle(title: string): boolean {
  const trimmed = title.trim()
  if (trimmed === '' || trimmed.length > MAX_HEADING_LENGTH) return false
  if (!TITLE_CHARS.test(trimmed)) return false
  const words = trimmed.split(/\s+/)
  if (words.length > MAX_TITLE_WORDS) return false
  // Must start with a capitalized letter (rules out "3 768 12 ..." table rows).
  if (!/^[(']?\p{Lu}/u.test(words[0])) return false
  return words.every(
    (word, i) =>
      /^[(']?\p{Lu}/u.test(word) ||
      (i > 0 && SMALL_WORDS.has(word.toLowerCase())),
  )
}

type Heading = {
  title: string
  type: SectionType
  lineStart: number
  /** Offset just after the heading line's newline (or end of text). */
  bodyStart: number
}

function findHeadings(text: string): Heading[] {
  const headings: Heading[] = []
  let lineStart = 0
  let previousBlank = true // the start of the document counts as a paragraph start
  let lastTopLevel = 0
  while (lineStart <= text.length) {
    const newline = text.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? text.length : newline
    const line = text.slice(lineStart, lineEnd)
    const number = topLevelNumber(line)

    let type = matchHeading(line)
    if (type) {
      if (number !== null) lastTopLevel = number
    } else if (
      number !== null &&
      number === lastTopLevel + 1 &&
      previousBlank &&
      looksLikeHeadingTitle(TOP_LEVEL_NUMBER.exec(line.trim())![2])
    ) {
      type = 'other'
      lastTopLevel = number
    }

    if (type) {
      headings.push({
        title: line.trim().replace(/:$/, ''),
        type,
        lineStart,
        bodyStart: newline === -1 ? text.length : newline + 1,
      })
    }
    previousBlank = line.trim() === ''
    if (newline === -1) break
    lineStart = newline + 1
  }
  return headings
}

/**
 * Splits a document into ordered sections. Every character of the document is
 * accounted for: heading lines become section titles, and all other text lives
 * in some section's `text`. Sections whose heading has no body are kept (with
 * empty text) so no heading is silently dropped.
 */
export function detectSections(doc: NormalizedDocument): DocumentSection[] {
  const { text } = doc
  if (text.trim() === '') return []

  const headings = findHeadings(text)
  const sections: DocumentSection[] = []

  const push = (
    title: string,
    sectionType: SectionType,
    rangeStart: number,
    rangeEnd: number,
  ) => {
    const raw = text.slice(rangeStart, rangeEnd)
    const body = raw.trim()
    const charStart = body === '' ? rangeStart : rangeStart + raw.indexOf(body)
    sections.push({
      position: sections.length,
      title,
      sectionType,
      text: body,
      charStart,
      pageStart: pageAt(doc, charStart),
      pageEnd: pageAt(doc, Math.max(charStart, charStart + body.length - 1)),
    })
  }

  if (headings.length === 0) {
    push('Full text', 'other', 0, text.length)
    return sections
  }

  // Text before the first heading (title, authors, an unlabeled abstract...).
  if (text.slice(0, headings[0].lineStart).trim() !== '') {
    push('Front matter', 'other', 0, headings[0].lineStart)
  }

  headings.forEach((heading, i) => {
    const end =
      i + 1 < headings.length ? headings[i + 1].lineStart : text.length
    push(heading.title, heading.type, heading.bodyStart, end)
  })

  return sections
}
