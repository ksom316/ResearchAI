import type { Paper } from '#/features/papers/types'
import { FIELD_KEYS } from './fields'
import { describeExtraction } from './status'
import type { ExtractionStatusView } from './status'
import type {
  ClaimSelection,
  ExtractionField,
  ExtractionOverview,
  ExtractionSource,
  FieldKey,
} from './types'

/**
 * Pure, browser-safe model for the Evidence Matrix UI: joins papers, extraction
 * overviews and field rows in memory, and decides how each cell is shown.
 */
export const FIELD_LABELS: Record<FieldKey, string> = {
  objective: 'Objective',
  methodology: 'Methodology',
  dataset: 'Dataset',
  findings: 'Findings',
  limitations: 'Limitations',
  future_work: 'Future Work',
  concepts: 'Concepts',
}

export type MatrixRow = {
  paper: Paper
  overview: ExtractionOverview | undefined
  fields: Partial<Record<FieldKey, ExtractionField>>
  status: ExtractionStatusView
}

/** One row per paper, in the papers' own order. Extraction data never adds or removes rows. */
export function buildMatrixRows(
  papers: readonly Paper[],
  overviews: readonly ExtractionOverview[],
  fields: readonly ExtractionField[],
): MatrixRow[] {
  const overviewByPaper = new Map(overviews.map((o) => [o.paperId, o]))
  const fieldsByPaper = new Map<string, Partial<Record<FieldKey, ExtractionField>>>()
  for (const field of fields) {
    const forPaper = fieldsByPaper.get(field.paperId) ?? {}
    forPaper[field.fieldKey] = field
    fieldsByPaper.set(field.paperId, forPaper)
  }
  return papers.map((paper) => {
    const overview = overviewByPaper.get(paper.id)
    return {
      paper,
      overview,
      fields: fieldsByPaper.get(paper.id) ?? {},
      // Stale values stay visible; the paper-level status says "Out of date".
      status: describeExtraction(paper.status, overview),
    }
  })
}

export type CellModel =
  | { kind: 'extracted'; items: string[]; first: string; more: number }
  | { kind: 'not_reported' }
  | { kind: 'failed' }
  | { kind: 'missing' }
  | { kind: 'malformed' }

/** How one field is presented. Never exposes raw JSON. */
export function cellModel(field: ExtractionField | undefined): CellModel {
  if (!field) return { kind: 'missing' }
  if (field.state === 'failed') return { kind: 'failed' }
  if (field.state === 'not_reported') return { kind: 'not_reported' }
  const items = field.items.map((i) => i.text)
  if (items.length === 0) return { kind: 'malformed' }
  return { kind: 'extracted', items, first: items[0], more: items.length - 1 }
}

export const itemCountLabel = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`

export type MatrixSummary = {
  total: number
  /** Extracted and up to date. */
  current: number
  /** Queued or running. */
  active: number
  /** Out of date, partial or failed. */
  attention: number
}

export function summarizeMatrix(rows: readonly MatrixRow[]): MatrixSummary {
  const summary: MatrixSummary = {
    total: rows.length,
    current: 0,
    active: 0,
    attention: 0,
  }
  for (const { status } of rows) {
    if (status.key === 'extracted') summary.current++
    else if (status.key === 'queued' || status.key === 'extracting') summary.active++
    else if (
      status.key === 'out_of_date' ||
      status.key === 'partial' ||
      status.key === 'failed'
    ) {
      summary.attention++
    }
  }
  return summary
}

type QueryLike<T> = {
  data: T | undefined
  error: Error | null
  isPending: boolean
}

export type MatrixState =
  | { kind: 'loading' }
  | { kind: 'error'; source: 'papers' | 'extraction'; error: Error }
  | { kind: 'empty' }
  | { kind: 'ready'; rows: MatrixRow[] }

/**
 * What the tab shows. An extraction-data failure is an ERROR, never "Not extracted":
 * rows are only built once both extraction queries have succeeded.
 */
export function deriveMatrixState(queries: {
  papers: QueryLike<readonly Paper[]>
  overviews: QueryLike<readonly ExtractionOverview[]>
  fields: QueryLike<readonly ExtractionField[]>
}): MatrixState {
  const { papers, overviews, fields } = queries
  if (papers.error) return { kind: 'error', source: 'papers', error: papers.error }
  if (papers.isPending || !papers.data) return { kind: 'loading' }
  if (papers.data.length === 0) return { kind: 'empty' }
  const failed = overviews.error ?? fields.error
  if (failed) return { kind: 'error', source: 'extraction', error: failed }
  if (overviews.isPending || fields.isPending || !overviews.data || !fields.data) {
    return { kind: 'loading' }
  }
  return {
    kind: 'ready',
    rows: buildMatrixRows(papers.data, overviews.data, fields.data),
  }
}

/**
 * Runs one extraction request per paper at a time. A paper already in flight is ignored,
 * others are unaffected. `onChange` receives the current in-flight set after each change.
 * Errors are swallowed here: the mutation hook already reports them.
 */
export async function requestExtractionOnce(
  paperId: string,
  inFlight: Set<string>,
  request: (paperId: string) => Promise<unknown>,
  onChange: (snapshot: ReadonlySet<string>) => void,
): Promise<void> {
  if (inFlight.has(paperId)) return
  inFlight.add(paperId)
  onChange(new Set(inFlight))
  try {
    await request(paperId)
  } catch {
    // reported by the mutation's own error handling
  } finally {
    inFlight.delete(paperId)
    onChange(new Set(inFlight))
  }
}

export const MATRIX_FIELD_KEYS = FIELD_KEYS

export type ClaimWithSources = {
  /** Position of the claim within its field (matches the sources' item_index). */
  index: number
  text: string
  /** Ordered by ord. May be empty: provenance is never invented. */
  sources: ExtractionSource[]
}

/**
 * Attaches each source to the claim whose position equals the source's item_index, and
 * nothing else: no matching by text. Sources whose item_index has no claim are dropped
 * (they never attach to another claim). Order within a claim follows ord.
 */
export function groupSourcesByClaim(
  claims: readonly string[],
  sources: readonly ExtractionSource[],
): ClaimWithSources[] {
  const ordered = [...sources].sort(
    (a, b) => a.itemIndex - b.itemIndex || a.ord - b.ord,
  )
  return claims.map((text, index) => ({
    index,
    text,
    sources: ordered.filter((s) => s.itemIndex === index),
  }))
}

export type SelectedClaims = {
  paperId: string
  fieldKey: FieldKey
  paperTitle: string
  fieldLabel: string
  claims: string[]
  isStale: boolean
}

/**
 * Resolves a selection against the current rows. Only an extracted field with usable
 * claims can be inspected; anything else (or a paper/field that no longer exists after a
 * refresh) resolves to null, which closes the sheet.
 */
export function findSelectedClaims(
  rows: readonly MatrixRow[],
  selection: ClaimSelection | null,
): SelectedClaims | null {
  if (!selection) return null
  const row = rows.find((r) => r.paper.id === selection.paperId)
  if (!row) return null
  const model = cellModel(row.fields[selection.fieldKey])
  if (model.kind !== 'extracted') return null
  return {
    paperId: row.paper.id,
    fieldKey: selection.fieldKey,
    paperTitle: row.paper.title,
    fieldLabel: FIELD_LABELS[selection.fieldKey],
    claims: model.items,
    isStale: row.overview?.isStale ?? false,
  }
}
