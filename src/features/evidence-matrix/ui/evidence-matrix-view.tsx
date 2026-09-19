import type { ReactNode } from 'react'
import type { Paper } from '#/features/papers/types'
import type { ClaimSelection } from '../types'
import { summarizeMatrix } from '../matrix-model'
import type { MatrixRow } from '../matrix-model'
import { EvidenceMatrixCards } from './evidence-matrix-cards'
import { EvidenceMatrixTable } from './evidence-matrix-table'
import { EvidenceMatrixToolbar } from './evidence-matrix-toolbar'

/**
 * The loaded matrix: toolbar plus the desktop table (md and up) or the mobile cards
 * (below md). Both are rendered and switched with CSS; the hidden one is display:none,
 * so it is neither visible nor focusable, and both call the same per-paper handler.
 */
export function EvidenceMatrixView({
  rows,
  pendingIds,
  onRequest,
  onViewEvidence,
  renderTitle = (paper) => <span>{paper.title}</span>,
}: {
  rows: readonly MatrixRow[]
  pendingIds: ReadonlySet<string>
  onRequest: (paperId: string) => void
  /** One selection model for both layouts; the sheet lives in the tab. */
  onViewEvidence: (selection: ClaimSelection) => void
  renderTitle?: (paper: Paper) => ReactNode
}) {
  return (
    <div className="space-y-4">
      <EvidenceMatrixToolbar summary={summarizeMatrix(rows)} />
      <div className="hidden md:block">
        <EvidenceMatrixTable
          rows={rows}
          pendingIds={pendingIds}
          onRequest={onRequest}
          onViewEvidence={onViewEvidence}
          renderTitle={renderTitle}
        />
      </div>
      <div className="md:hidden">
        <EvidenceMatrixCards
          rows={rows}
          pendingIds={pendingIds}
          onRequest={onRequest}
          onViewEvidence={onViewEvidence}
          renderTitle={renderTitle}
        />
      </div>
    </div>
  )
}
