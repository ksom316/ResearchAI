/**
 * Turns pdf.js text items into plain text with lines and paragraph breaks, using
 * only item positions and sizes (deterministic, no heuristics beyond geometry).
 *
 * pdf.js returns text in content-stream order with each item's position in the
 * `transform` matrix ([a, b, c, d, x, y]). We keep that order (so multi-column
 * layouts stay in the order the PDF author wrote them), start a new line when
 * the baseline moves, and a new paragraph when the vertical gap is clearly
 * larger than normal line spacing.
 */

export type LayoutItem = {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL?: boolean
}

/** Vertical baseline change (in font heights) that starts a new line. */
const LINE_TOLERANCE = 0.5
/** Line pitch (in font heights) above which a gap is treated as a paragraph break. */
const PARAGRAPH_GAP = 1.9
/** Horizontal gap (in font heights) above which two items on a line get a space. */
const WORD_GAP = 0.15

type Line = {
  text: string
  y: number
  height: number
  endX: number
  gapBefore: boolean
}

export function itemsToText(items: readonly LayoutItem[]): string {
  const lines: Line[] = []
  let current: Line | null = null
  let forceBreak = false

  for (const item of items) {
    if (item.str === '') {
      if (item.hasEOL) forceBreak = true
      continue
    }
    const x = item.transform[4]
    const y = item.transform[5]
    const height =
      item.height > 0 ? item.height : Math.abs(item.transform[3]) || 10

    const newLine =
      !current ||
      forceBreak ||
      Math.abs(y - current.y) >
        LINE_TOLERANCE * Math.max(height, current.height)

    if (newLine) {
      if (current) lines.push(current)
      const pitch: number = current ? Math.abs(current.y - y) : 0
      current = {
        text: item.str,
        y,
        height,
        endX: x + item.width,
        gapBefore: current
          ? pitch > PARAGRAPH_GAP * Math.max(height, current.height)
          : false,
      }
    } else if (current) {
      const gap = x - current.endX
      const needsSpace =
        gap > WORD_GAP * height &&
        !current.text.endsWith(' ') &&
        !item.str.startsWith(' ')
      current.text += (needsSpace ? ' ' : '') + item.str
      current.endX = x + item.width
    }
    forceBreak = item.hasEOL === true
  }
  if (current) lines.push(current)

  let out = ''
  lines.forEach((line, i) => {
    const text = line.text.replace(/[ \t]+$/g, '')
    if (text === '') return
    if (i > 0) out += line.gapBefore ? '\n\n' : '\n'
    out += text
  })
  return out
}
