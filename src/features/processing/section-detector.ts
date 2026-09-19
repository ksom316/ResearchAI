import { pageAt } from './normalize'
import type { DocumentSection, NormalizedDocument, SectionType } from './types'

/**
 * Conservative, deterministic heading detection for common academic sections.
 *
 * A line is a heading ONLY if the whole line (minus an optional number prefix
 * such as "2.", "3.1" or "II." and an optional trailing colon) is one of a fixed
 * vocabulary of headings, case-insensitively. Lines like "Introduction to graph
 * networks" or body sentences that merely mention "results" never match, and
 * unrecognized headings simply stay inside the previous section's text.
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
  while (lineStart <= text.length) {
    const newline = text.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? text.length : newline
    const line = text.slice(lineStart, lineEnd)
    const type = matchHeading(line)
    if (type) {
      headings.push({
        title: line.trim().replace(/:$/, ''),
        type,
        lineStart,
        bodyStart: newline === -1 ? text.length : newline + 1,
      })
    }
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
