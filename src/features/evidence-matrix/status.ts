import type { PaperStatus } from '#/features/papers/types'
import type { ExtractionOverview, RequestResult } from './types'

/**
 * Pure helpers for the Evidence Matrix UI. The browser cannot read attempts or
 * last_error (intentionally not granted), so nothing here depends on them.
 */
export type ExtractionAction = 'extract' | 'update' | 'retry'

export type ExtractionStatusKey =
  | 'waiting'
  | 'not_extracted'
  | 'queued'
  | 'extracting'
  | 'extracted'
  | 'out_of_date'
  | 'partial'
  | 'failed'

export type ExtractionStatusView = {
  key: ExtractionStatusKey
  label: string
  /** The button to offer, or null when nothing can be requested. */
  action: ExtractionAction | null
  /** Pending or running: the view should keep refreshing. */
  active: boolean
  tone: 'muted' | 'active' | 'success' | 'warning' | 'danger'
}

const ACTION_LABELS: Record<ExtractionAction, string> = {
  extract: 'Extract',
  update: 'Update',
  retry: 'Retry',
}

export const actionLabel = (action: ExtractionAction) => ACTION_LABELS[action]

/** What to show (and offer) for one paper, from its paper status and extraction overview. */
export function describeExtraction(
  paperStatus: PaperStatus,
  overview: ExtractionOverview | undefined,
): ExtractionStatusView {
  if (paperStatus !== 'ready') {
    return { key: 'waiting', label: 'Waiting for processing', action: null, active: false, tone: 'muted' }
  }
  if (!overview) {
    return { key: 'not_extracted', label: 'Not extracted', action: 'extract', active: false, tone: 'muted' }
  }
  switch (overview.status) {
    case 'pending':
      return { key: 'queued', label: 'Queued', action: null, active: true, tone: 'active' }
    case 'running':
      return { key: 'extracting', label: 'Extracting…', action: null, active: true, tone: 'active' }
    case 'complete':
      return overview.isStale
        ? { key: 'out_of_date', label: 'Out of date', action: 'update', active: false, tone: 'warning' }
        : { key: 'extracted', label: 'Extracted', action: null, active: false, tone: 'success' }
    case 'partial':
      return { key: 'partial', label: 'Partial', action: 'retry', active: false, tone: 'warning' }
    case 'failed':
      return { key: 'failed', label: 'Extraction failed', action: 'retry', active: false, tone: 'danger' }
  }
}

/** True while any extraction is queued or running, i.e. its state will change on its own. */
export function hasActiveExtraction(
  overviews: readonly ExtractionOverview[] | undefined,
): boolean {
  return (
    overviews?.some((o) => o.status === 'pending' || o.status === 'running') ??
    false
  )
}

/** User-facing text for each request answer. Deliberately says nothing about internals. */
export const REQUEST_MESSAGES: Record<
  RequestResult,
  { tone: 'success' | 'info' | 'error'; message: string }
> = {
  requested: {
    tone: 'success',
    message: 'Extraction requested. This view will update automatically.',
  },
  unchanged: {
    tone: 'info',
    message: 'Nothing to do: this paper is already queued or up to date.',
  },
  not_ready: {
    tone: 'info',
    message: 'This paper is still being processed. Try again once it is ready.',
  },
  not_found: {
    tone: 'error',
    message: 'That paper could not be found.',
  },
}

export const REQUEST_ERROR_MESSAGE =
  'Could not request extraction. Please try again.'
