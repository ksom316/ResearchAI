import type { DetectedTable, ExtractedDocument } from './types'

/**
 * Deterministic table detection (R12). Runs on the RAW per-page text from the
 * extractor, before normalizeText() collapses tabs to spaces: PdfExtractor
 * implementations emit a tab for wide horizontal gaps between text items
 * (see worker/text-layout.ts COLUMN_GAP), which is the only signal this needs.
 *
 * This is a text-geometry heuristic, not a layout/ML table model: it finds
 * runs of consecutive lines that all split into the same number of
 * tab-separated columns, which is what a real table (or anything shaped like
 * one - a reference list with aligned numbers, say) prints as. Confidence is
 * reported honestly rather than implied; callers that need high precision
 * should treat low-confidence tables as a fact-extraction hint, not ground
 * truth structure.
 */

/** Fewer consecutive aligned-column lines than this is not called a table. */
const MIN_TABLE_ROWS = 3
/** A table must have at least this many columns to be structurally interesting. */
const MIN_COLUMNS = 2

type RawLine = { text: string; cells: string[] }

function splitPage(text: string): RawLine[] {
  return text.split('\n').map((line) => ({
    text: line,
    cells: line.split('\t').map((c) => c.trim()).filter((c) => c !== ''),
  }))
}

/** The nearest non-empty, non-tabular line above `startIndex`, treated as a caption candidate. */
function captionAbove(lines: readonly RawLine[], startIndex: number): string | null {
  for (let i = startIndex - 1; i >= 0 && i >= startIndex - 3; i--) {
    const trimmed = lines[i].text.trim()
    if (trimmed === '') continue
    if (lines[i].cells.length >= MIN_COLUMNS) return null // itself tabular, not a caption
    return trimmed.length <= 200 ? trimmed : null
  }
  return null
}

/** The most frequent column count in a run of tabular lines (ties favor the smaller count). */
function modeColumns(rows: readonly string[][]): number {
  const counts = new Map<number, number>()
  for (const row of rows) counts.set(row.length, (counts.get(row.length) ?? 0) + 1)
  let best = 0
  let bestCount = 0
  for (const [columns, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (count > bestCount) {
      best = columns
      bestCount = count
    }
  }
  return best
}

/**
 * Detects tables on a single page. A "run" is any sequence of consecutive
 * lines that all have at least MIN_COLUMNS tab-separated cells; a run does
 * not have to agree on the exact column count (OCR noise and merged cells
 * routinely drop or add one), so consistency is reported as `confidence`
 * instead of used to split the run.
 */
function detectPageTables(pageText: string): Omit<DetectedTable, 'pageStart' | 'pageEnd' | 'tableIndex'>[] {
  const lines = splitPage(pageText)
  const tables: Omit<DetectedTable, 'pageStart' | 'pageEnd' | 'tableIndex'>[] = []

  let runStart = -1

  const flush = (endExclusive: number) => {
    const length = endExclusive - runStart
    if (runStart !== -1 && length >= MIN_TABLE_ROWS) {
      const rowLines = lines.slice(runStart, endExclusive)
      const rows = rowLines.map((l) => l.cells)
      const [headers, ...dataRows] = rows
      const columns = modeColumns(rows)
      const consistent = rows.filter((r) => r.length === columns).length
      tables.push({
        caption: captionAbove(lines, runStart),
        headers,
        rows: dataRows,
        confidence: Math.round((consistent / rows.length) * 100) / 100,
      })
    }
    runStart = -1
  }

  lines.forEach((line, i) => {
    if (line.cells.length >= MIN_COLUMNS) {
      if (runStart === -1) runStart = i
    } else if (runStart !== -1) {
      flush(i)
    }
  })
  flush(lines.length)

  return tables
}

/** Detects tables across the whole document, from the extractor's raw per-page text. */
export function detectTables(extracted: ExtractedDocument): DetectedTable[] {
  const tables: DetectedTable[] = []
  for (const page of [...extracted.pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    for (const table of detectPageTables(page.text)) {
      tables.push({
        ...table,
        tableIndex: tables.length,
        pageStart: page.pageNumber,
        pageEnd: page.pageNumber,
      })
    }
  }
  return tables
}
