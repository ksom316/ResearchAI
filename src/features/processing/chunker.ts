import { pageAt } from './normalize'
import type {
  ChunkOptions,
  DocumentChunk,
  DocumentSection,
  NormalizedDocument,
} from './types'

/**
 * Sizes are in CHARACTERS, not model tokens. ~4 characters per English token
 * means 3600 characters is roughly 800-900 tokens; treat that as an estimate.
 */
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetChars: 3600,
  overlapChars: 400,
}

type Span = { start: number; end: number }

/**
 * Deterministic, section-aware chunker.
 *
 * Text is first cut into "units" (paragraphs; sentences when a paragraph is too
 * long; fixed-size slices when a sentence is still too long). Units are then
 * packed greedily into chunks up to `targetChars`, and each new chunk re-starts
 * from whole trailing units of the previous one totalling at most `overlapChars`.
 *
 * Guarantees, for every section:
 *  - chunk text is exactly `section.text.slice(charStart, charEnd)`;
 *  - every non-whitespace character of the section is inside some chunk;
 *  - chunks are ordered, never exceed `targetChars`, and each starts after the
 *    previous chunk's start (so chunking always terminates).
 * Overlap works on whole units, so it is approximate and can be 0 when the
 * trailing unit is longer than `overlapChars`.
 */
export function chunkText(
  text: string,
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): { text: string; charStart: number; charEnd: number }[] {
  const { targetChars, overlapChars } = options
  if (!Number.isInteger(targetChars) || targetChars < 1) {
    throw new RangeError('targetChars must be a positive integer')
  }
  if (
    !Number.isInteger(overlapChars) ||
    overlapChars < 0 ||
    overlapChars >= targetChars
  ) {
    throw new RangeError('overlapChars must be an integer in [0, targetChars)')
  }

  const units = splitIntoUnits(text, options)
  const chunks: { text: string; charStart: number; charEnd: number }[] = []

  let i = 0
  while (i < units.length) {
    let j = i + 1
    while (j < units.length && units[j].end - units[i].start <= targetChars) j++

    const start = units[i].start
    const end = units[j - 1].end
    chunks.push({
      text: text.slice(start, end),
      charStart: start,
      charEnd: end,
    })

    if (j >= units.length) break

    // Step back over whole trailing units to create the overlap, but always
    // advance by at least one unit.
    let next = j
    while (next - 1 > i && end - units[next - 1].start <= overlapChars) next--
    i = next
  }

  return chunks
}

/** Paragraph -> sentence -> fixed-slice units. Together they cover all non-whitespace text. */
function splitIntoUnits(text: string, options: ChunkOptions): Span[] {
  const { targetChars, overlapChars } = options
  // Slices of an unbreakable run are at most `overlapChars` long so that some
  // overlap is still possible between them.
  const sliceSize = overlapChars > 0 ? overlapChars : targetChars
  const units: Span[] = []

  for (const paragraph of nonBlankSpans(text, /\n[ \t]*\n/g, 0, text.length)) {
    if (paragraph.end - paragraph.start <= targetChars) {
      units.push(paragraph)
      continue
    }
    for (const sentence of splitSentences(text, paragraph)) {
      if (sentence.end - sentence.start <= targetChars) {
        units.push(sentence)
      } else {
        units.push(...hardSplit(text, sentence, sliceSize))
      }
    }
  }
  return units
}

/** Trimmed, non-empty spans of text[from, to) separated by `separator`. */
function nonBlankSpans(
  text: string,
  separator: RegExp,
  from: number,
  to: number,
): Span[] {
  const spans: Span[] = []
  let cursor = from
  const add = (rawStart: number, rawEnd: number) => {
    const raw = text.slice(rawStart, rawEnd)
    const trimmed = raw.trim()
    if (trimmed === '') return
    const start = rawStart + raw.indexOf(trimmed)
    spans.push({ start, end: start + trimmed.length })
  }
  const slice = text.slice(0, to)
  separator.lastIndex = from
  for (
    let match = separator.exec(slice);
    match;
    match = separator.exec(slice)
  ) {
    add(cursor, match.index)
    cursor = match.index + match[0].length
  }
  add(cursor, to)
  return spans
}

const SENTENCE_BREAK = /(?<=[.!?]["')\]]?)\s+(?=["'([]?[A-Z0-9])/g

function splitSentences(text: string, paragraph: Span): Span[] {
  return nonBlankSpans(text, SENTENCE_BREAK, paragraph.start, paragraph.end)
}

/** Cuts an over-long span into slices of at most `size`, preferring whitespace boundaries. */
function hardSplit(text: string, span: Span, size: number): Span[] {
  const slices: Span[] = []
  let start = span.start
  while (start < span.end) {
    let end = Math.min(start + size, span.end)
    if (end < span.end) {
      const lastSpace = text.lastIndexOf(' ', end)
      if (lastSpace > start) end = lastSpace
    }
    const raw = text.slice(start, end)
    const trimmed = raw.trim()
    if (trimmed !== '') {
      const s = start + raw.indexOf(trimmed)
      slices.push({ start: s, end: s + trimmed.length })
    }
    // `end` always advances: it is > start because lastSpace > start.
    start = end
  }
  return slices
}

/** Chunks every section, numbering chunks across the whole paper. */
export function chunkSections(
  doc: NormalizedDocument,
  sections: DocumentSection[],
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = []
  for (const section of sections) {
    for (const piece of chunkText(section.text, options)) {
      const docStart = section.charStart + piece.charStart
      chunks.push({
        chunkIndex: chunks.length,
        sectionPosition: section.position,
        text: piece.text,
        charStart: piece.charStart,
        charEnd: piece.charEnd,
        pageStart: pageAt(doc, docStart),
        pageEnd: pageAt(doc, section.charStart + piece.charEnd - 1),
      })
    }
  }
  return chunks
}
