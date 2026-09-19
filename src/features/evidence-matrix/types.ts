import type { FieldKey } from './fields'

/**
 * Browser-facing Evidence Matrix types. Pure types only: nothing here imports the
 * extraction service, the worker or any server-only code.
 */
export type { FieldKey }

export type ExtractionStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'partial'
  | 'failed'

/** One row of paper_extraction_overview (browser-granted columns only). */
export type ExtractionOverview = {
  paperId: string
  schemaVersion: number
  status: ExtractionStatus
  sourceCompletedAt: string
  completedAt: string | null
  provider: string | null
  model: string | null
  createdAt: string
  updatedAt: string
  /** Derived by the database: the paper was reprocessed after this extraction. */
  isStale: boolean
}

export type FieldState = 'extracted' | 'not_reported' | 'failed'

export type FieldItem = { text: string }

/** One row of paper_extraction_fields with its JSON value normalized. */
export type ExtractionField = {
  paperId: string
  schemaVersion: number
  fieldKey: FieldKey
  state: FieldState
  items: FieldItem[]
  /** True when the stored JSON did not have the expected {"items":[{"text"}]} shape. */
  itemsMalformed: boolean
  createdAt: string
  updatedAt: string
}

/** One row of paper_extraction_sources (provenance snapshot). */
export type ExtractionSource = {
  paperId: string
  schemaVersion: number
  fieldKey: FieldKey
  itemIndex: number
  ord: number
  /** Live pointers; cleared (null) when the paper was reprocessed. The snapshot remains. */
  chunkId: string | null
  sectionId: string | null
  sectionTitle: string
  sectionType: string
  pageStart: number | null
  pageEnd: number | null
  excerpt: string | null
}

/** The paper + field whose evidence is being inspected. */
export type ClaimSelection = { paperId: string; fieldKey: FieldKey }

/** What request_paper_extraction can answer. */
export type RequestResult =
  | 'requested'
  | 'unchanged'
  | 'not_ready'
  | 'not_found'
