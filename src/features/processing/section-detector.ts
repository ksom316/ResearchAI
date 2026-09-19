import { pageAt, pageIndexAt } from './normalize'
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
 *    The same rules apply to IEEE-style Roman numerals ("II. OVERVIEW OF ...",
 *    "IV. DATASETS"): a Roman numeral I-XX followed by a period, next in
 *    sequence (I -> II -> III ...). Arabic and Roman numbering are tracked
 *    separately; a structural heading of one kind is not accepted once the
 *    other kind has established its own sequence, and Roman titles need at
 *    least three letters. Lettered ("A. Table") and "1)" subsection styles are
 *    never top-level headings.
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

const ROMAN_TOP_LEVEL = /^([IVXL]{1,5})\.\s+(\S.*)$/

const ROMAN_VALUES: Readonly<Record<string, number>> = Object.fromEntries(
  [
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
  ].map((numeral, i) => [numeral, i + 1]),
)

type Numbering = { kind: 'arabic' | 'roman'; value: number; title: string }

/**
 * The top-level number at the start of a line: an Arabic integer ("3 BERT",
 * "3. BERT") or an uppercase Roman numeral I-XX followed by a period
 * ("IV. DATASETS"). "3.1 X", "A. X", "1) X" and out-of-range numerals give null.
 */
export function parseTopLevelNumbering(line: string): Numbering | null {
  const trimmed = line.trim()
  const arabic = TOP_LEVEL_NUMBER.exec(trimmed)
  if (arabic)
    return { kind: 'arabic', value: Number(arabic[1]), title: arabic[2] }
  const roman = ROMAN_TOP_LEVEL.exec(trimmed)
  const value = roman ? ROMAN_VALUES[roman[1]] : undefined
  return roman && value !== undefined
    ? { kind: 'roman', value, title: roman[2] }
    : null
}

const letterCount = (text: string) => (text.match(/\p{L}/gu) ?? []).length

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

type Line = {
  start: number
  /** Offset just after the line's newline (or end of text). */
  next: number
  text: string
  /** Index of the page the line is on (into pageStarts/pageNumbers). */
  page: number
}

function splitLines(doc: NormalizedDocument): Line[] {
  const { text } = doc
  const lines: Line[] = []
  let start = 0
  while (start <= text.length) {
    const newline = text.indexOf('\n', start)
    const end = newline === -1 ? text.length : newline
    lines.push({
      start,
      next: newline === -1 ? text.length : newline + 1,
      text: text.slice(start, end),
      page: pageIndexAt(doc, start) ?? 0,
    })
    if (newline === -1) break
    start = newline + 1
  }
  return lines
}

/** Case- and spacing-insensitive identity of a heading line, numbering included. */
const headingKey = (line: string) =>
  line.trim().replace(/:$/, '').replace(/\s+/g, ' ').toLowerCase()

/**
 * The heading key with one plausible printed page number removed from the front
 * or back ("146 BIBLIOGRAPHY" / "BIBLIOGRAPHY 147" -> "bibliography"), or null
 * if there is none to remove. ONLY for running-header comparison in a page's
 * header/footer zone; it is never used to recognize headings.
 *
 * Guards against removing part of a real heading:
 *  - the number is a bare integer of 1-4 digits and the rest must itself be a
 *    known heading (so "3 BERT" and "4.1 Introduction" are left alone);
 *  - a leading number that is the next top-level section number ("1 Introduction"
 *    after no sections) is a genuine section number, not a page number;
 *  - "Appendix 2"-style headings keep their number.
 */
function withoutPageNumber(line: string, lastArabic: number): string | null {
  const trimmed = line.trim()
  const leading = /^(\d{1,4})\s+(\S.*)$/.exec(trimmed)
  const trailing = /^(\S.*?)\s+(\d{1,4})$/.exec(trimmed)
  const [number, rest] = leading
    ? [Number(leading[1]), leading[2]]
    : trailing
      ? [null, trailing[1]]
      : [null, null]
  if (rest === null) return null
  if (leading && number === lastArabic + 1) return null
  const type = matchHeading(rest)
  if (type === null || type === 'appendix') return null
  return headingKey(rest)
}

/** How many non-blank lines at the top and bottom of a page count as its header/footer zone. */
const RUNNING_ZONE_LINES = 2

/** Indexes of lines in the top/bottom zone of their page. */
function pageBoundaryLines(lines: readonly Line[]): Set<number> {
  const byPage = new Map<number, number[]>()
  lines.forEach((line, i) => {
    if (line.text.trim() === '') return
    const list = byPage.get(line.page)
    if (list) list.push(i)
    else byPage.set(line.page, [i])
  })
  const boundary = new Set<number>()
  for (const indexes of byPage.values()) {
    for (const i of indexes.slice(0, RUNNING_ZONE_LINES)) boundary.add(i)
    for (const i of indexes.slice(-RUNNING_ZONE_LINES)) boundary.add(i)
  }
  return boundary
}

function findHeadings(doc: NormalizedDocument): Heading[] {
  const lines = splitLines(doc)
  const boundary = pageBoundaryLines(lines)

  // Known headings on each page (by key, with line index), used to tell a running
  // header from the real heading it announces.
  const knownByPage = new Map<number, { key: string; index: number }[]>()
  lines.forEach((line, i) => {
    if (matchHeading(line.text) === null) return
    const entry = { key: headingKey(line.text), index: i }
    const list = knownByPage.get(line.page)
    if (list) list.push(entry)
    else knownByPage.set(line.page, [entry])
  })

  const headings: Heading[] = []
  let previousBlank = true // the start of the document counts as a paragraph start
  // Last accepted top-level number per numbering style, tracked independently.
  const last = { arabic: 0, roman: 0 }
  // Heading keys seen in each page's header/footer zone (accepted or not).
  const zoneKeys = new Map<number, Set<string>>()
  // The same, for headings that carried a printed page number (number removed).
  const bareZoneKeys = new Map<number, Set<string>>()
  let openKey: string | null = null
  let openBare: string | null = null // openKey without a joined page number, if it had one

  lines.forEach((line, i) => {
    const blank = line.text.trim() === ''
    const numbering = parseTopLevelNumbering(line.text)

    let type = matchHeading(line.text)
    let counterUpdate = false
    if (type) {
      // Known numbered headings (re)sync their own numbering style.
      counterUpdate = numbering !== null
    } else if (numbering && previousBlank) {
      const otherKind = numbering.kind === 'arabic' ? 'roman' : 'arabic'
      if (
        numbering.value === last[numbering.kind] + 1 &&
        last[otherKind] === 0 &&
        looksLikeHeadingTitle(numbering.title) &&
        (numbering.kind === 'arabic' || letterCount(numbering.title) >= 3)
      ) {
        type = 'other'
        counterUpdate = true
      }
    }
    previousBlank = blank
    if (!type) return

    const key = headingKey(line.text)
    // Same heading with a joined printed page number removed (or null); used only
    // for running-header comparison, never to recognize headings.
    const bare = withoutPageNumber(line.text, last.arabic)
    if (boundary.has(i)) {
      // A heading in a page's header/footer zone is a RUNNING HEADER (not a new
      // section) if it repeats something already known:
      //  - it is the section that is already open;
      //  - the same heading appears again later on this page (the header
      //    announces a section that starts further down; that one is real);
      //  - the previous page had the same heading in its header/footer zone;
      //  - any of the above after removing a printed page number joined to the
      //    heading ("146 BIBLIOGRAPHY" vs the open "Bibliography").
      // Its text stays in the open section; only the heading is ignored.
      const seenOnPreviousPage = zoneKeys.get(line.page - 1)?.has(key) ?? false
      const bareOnPreviousPage =
        bare !== null && (bareZoneKeys.get(line.page - 1)?.has(bare) ?? false)
      const appearsLater = (knownByPage.get(line.page) ?? []).some(
        (other) => other.index > i && (other.key === key || other.key === bare),
      )
      const zone = zoneKeys.get(line.page) ?? new Set<string>()
      zone.add(key)
      zoneKeys.set(line.page, zone)
      if (bare !== null) {
        const bareZone = bareZoneKeys.get(line.page) ?? new Set<string>()
        bareZone.add(bare)
        bareZoneKeys.set(line.page, bareZone)
      }
      if (
        key === openKey ||
        key === openBare ||
        (bare !== null && (bare === openKey || bare === openBare)) ||
        appearsLater ||
        seenOnPreviousPage ||
        bareOnPreviousPage
      ) {
        return
      }
    }

    if (counterUpdate && numbering) last[numbering.kind] = numbering.value
    openKey = key
    openBare = bare
    headings.push({
      title: line.text.trim().replace(/:$/, ''),
      type,
      lineStart: line.start,
      bodyStart: line.next,
    })
  })
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

  const headings = findHeadings(doc)
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
