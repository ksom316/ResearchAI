import type { PaperCitationMetadata } from '#/features/citations/types'
import type {
  ExtractionField,
  ExtractionOverview,
} from '#/features/evidence-matrix/types'
import type { PaperCoverage } from '#/features/search/types'
import type { ClaimSupportAssessment } from '#/features/claim-checker/types'
import type { GroundedDraft } from '#/features/writer/types'

export type InspectorScope = 'workspace' | 'draft'
export type InspectorSeverity = 'info' | 'attention' | 'significant'

export type InspectorActionTarget =
  | { type: 'paper'; paperId: string }
  | { type: 'workspace'; tab: 'papers' | 'evidence-matrix' }
  | { type: 'draft-unit'; unitId: string }

export type InspectorFinding = {
  id: string
  scope: InspectorScope
  kind: string
  severity: InspectorSeverity
  title: string
  message: string
  actionTarget?: InspectorActionTarget
  relatedPaperIds: string[]
  relatedUnitIds: string[]
}

export type WorkspaceInspectorPaper = {
  paperId: string
  title: string
  status: 'uploaded' | 'processing' | 'ready' | 'failed'
  citationMetadata: PaperCitationMetadata
  searchCoverage?: PaperCoverage | null
  matrixOverview?: ExtractionOverview | null
  matrixFields?: readonly ExtractionField[]
}

export type WorkspaceInspectorInput = {
  papers: readonly WorkspaceInspectorPaper[]
}

export type DraftInspectorInput = {
  draft: GroundedDraft
  assessmentsByUnitId: Readonly<
    Record<string, ClaimSupportAssessment | undefined>
  >
}
