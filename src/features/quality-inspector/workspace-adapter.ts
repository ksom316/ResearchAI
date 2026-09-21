import { paperRowToCitationMetadata } from '#/features/papers/citation-metadata'
import type { Paper } from '#/features/papers/types'
import type {
  ExtractionField,
  ExtractionOverview,
} from '#/features/evidence-matrix/types'
import type { PaperCoverage } from '#/features/search/types'
import type { WorkspaceInspectorInput } from './types'

export function buildWorkspaceInspectorInput(args: {
  papers: readonly Paper[]
  overviews: readonly ExtractionOverview[]
  fields: readonly ExtractionField[]
  coverage: readonly PaperCoverage[]
}): WorkspaceInspectorInput {
  const overviewByPaper = new Map(
    args.overviews.map((overview) => [overview.paperId, overview]),
  )
  const coverageByPaper = new Map(
    args.coverage.map((coverage) => [coverage.paperId, coverage]),
  )
  const fieldsByPaper = new Map<string, ExtractionField[]>()
  for (const field of args.fields) {
    const list = fieldsByPaper.get(field.paperId) ?? []
    list.push(field)
    fieldsByPaper.set(field.paperId, list)
  }

  return {
    papers: args.papers.map((paper) => ({
      paperId: paper.id,
      title: paper.title,
      status: paper.status,
      citationMetadata: paperRowToCitationMetadata(paper),
      searchCoverage: coverageByPaper.get(paper.id) ?? null,
      matrixOverview: overviewByPaper.get(paper.id) ?? null,
      matrixFields: fieldsByPaper.get(paper.id) ?? [],
    })),
  }
}
