import { assessCitationMetadataCompleteness } from '#/features/citations/normalize'
import { FIELD_KEYS } from '#/features/evidence-matrix/fields'
import type { ExtractionField } from '#/features/evidence-matrix/types'
import type { GroundedDraftUnit } from '#/features/writer/types'
import type {
  DraftInspectorInput,
  InspectorFinding,
  WorkspaceInspectorInput,
  WorkspaceInspectorPaper,
} from './types'

const severityOrder = { significant: 0, attention: 1, info: 2 } as const

function finish(findings: InspectorFinding[]): InspectorFinding[] {
  const unique = new Map(findings.map((finding) => [finding.id, finding]))
  return [...unique.values()].sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      a.id.localeCompare(b.id),
  )
}

function workspaceFinding(
  paper: WorkspaceInspectorPaper,
  finding: Omit<
    InspectorFinding,
    'id' | 'scope' | 'relatedPaperIds' | 'relatedUnitIds'
  > & { id: string },
): InspectorFinding {
  return {
    ...finding,
    id: `workspace:${finding.id}:${paper.paperId}`,
    scope: 'workspace',
    relatedPaperIds: [paper.paperId],
    relatedUnitIds: [],
  }
}

function fieldIsUsable(field: ExtractionField): boolean {
  return (
    field.state === 'extracted' &&
    !field.itemsMalformed &&
    field.items.some((item) => item.text.trim().length > 0)
  )
}

function hasUsableCurrentMatrix(paper: WorkspaceInspectorPaper): boolean {
  const overview = paper.matrixOverview
  return Boolean(
    paper.status === 'ready' &&
      overview &&
      !overview.isStale &&
      (overview.status === 'complete' || overview.status === 'partial') &&
      paper.matrixFields?.some(fieldIsUsable),
  )
}

export function inspectWorkspace(
  input: WorkspaceInspectorInput,
): InspectorFinding[] {
  const findings: InspectorFinding[] = []
  const papers = [...new Map(input.papers.map((paper) => [paper.paperId, paper])).values()]

  for (const paper of papers) {
    if (paper.status === 'failed') {
      findings.push(
        workspaceFinding(paper, {
          id: 'processing-failed',
          kind: 'processing_failed',
          severity: 'significant',
          title: 'Paper processing failed',
          message: 'This paper is unavailable for research intelligence until processing succeeds.',
          actionTarget: { type: 'paper', paperId: paper.paperId },
        }),
      )
    } else if (paper.status === 'uploaded' || paper.status === 'processing') {
      findings.push(
        workspaceFinding(paper, {
          id: 'processing-incomplete',
          kind: 'processing_incomplete',
          severity: 'info',
          title: 'Paper processing is not complete',
          message: 'This paper cannot contribute all research intelligence while processing is incomplete.',
          actionTarget: { type: 'paper', paperId: paper.paperId },
        }),
      )
    }

    const coverage = paper.searchCoverage?.state
    if (coverage === 'not_indexed' || coverage === 'index_failed' || coverage === 'index_stale') {
      findings.push(
        workspaceFinding(paper, {
          id: `search-${coverage}`,
          kind: `search_${coverage}`,
          severity: 'attention',
          title: 'Semantic search coverage needs attention',
          message: 'This paper is not currently available as current semantic-search evidence.',
          actionTarget: { type: 'paper', paperId: paper.paperId },
        }),
      )
    } else if (coverage === 'index_pending' || coverage === 'indexing') {
      findings.push(
        workspaceFinding(paper, {
          id: `search-${coverage}`,
          kind: `search_${coverage}`,
          severity: 'info',
          title: 'Semantic indexing is in progress',
          message: 'This paper will become searchable after its current indexing work finishes.',
          actionTarget: { type: 'paper', paperId: paper.paperId },
        }),
      )
    }

    const overview = paper.matrixOverview
    if (paper.status === 'ready' && !overview) {
      findings.push(
        workspaceFinding(paper, {
          id: 'matrix-missing',
          kind: 'matrix_missing',
          severity: 'attention',
          title: 'Evidence Matrix extraction is missing',
          message: 'This ready paper does not yet have extracted research-intelligence fields.',
          actionTarget: { type: 'workspace', tab: 'evidence-matrix' },
        }),
      )
    } else if (overview) {
      if (overview.isStale) {
        findings.push(
          workspaceFinding(paper, {
            id: 'matrix-stale',
            kind: 'matrix_stale',
            severity: 'attention',
            title: 'Evidence Matrix extraction is stale',
            message: 'This extraction belongs to an older paper-processing generation.',
            actionTarget: { type: 'workspace', tab: 'evidence-matrix' },
          }),
        )
      }
      if (overview.status === 'failed') {
        findings.push(
          workspaceFinding(paper, {
            id: 'matrix-failed',
            kind: 'matrix_failed',
            severity: 'significant',
            title: 'Evidence Matrix extraction failed',
            message: 'Structured research intelligence is unavailable for this paper because extraction failed.',
            actionTarget: { type: 'workspace', tab: 'evidence-matrix' },
          }),
        )
      } else if (overview.status === 'partial') {
        findings.push(
          workspaceFinding(paper, {
            id: 'matrix-partial',
            kind: 'matrix_partial',
            severity: 'attention',
            title: 'Evidence Matrix extraction is partial',
            message: 'Only part of the structured research intelligence is currently usable for this paper.',
            actionTarget: { type: 'workspace', tab: 'evidence-matrix' },
          }),
        )
      }

      const fieldByKey = new Map(
        (paper.matrixFields ?? []).map((field) => [field.fieldKey, field]),
      )
      for (const fieldKey of FIELD_KEYS) {
        const field = fieldByKey.get(fieldKey)
        if (!field || field.state === 'failed' || field.itemsMalformed ||
            (field.state === 'extracted' && !fieldIsUsable(field))) {
          findings.push(
            workspaceFinding(paper, {
              id: `matrix-field-${fieldKey}-unusable`,
              kind: 'matrix_field_unusable',
              severity: 'attention',
              title: 'Evidence Matrix field is unusable',
              message: `The ${fieldKey.replace('_', ' ')} field is missing, malformed, failed, or has no usable extracted item.`,
              actionTarget: { type: 'workspace', tab: 'evidence-matrix' },
            }),
          )
        } else if (field.state === 'not_reported') {
          findings.push(
            workspaceFinding(paper, {
              id: `matrix-field-${fieldKey}-not-reported`,
              kind: 'matrix_field_not_reported',
              severity: 'info',
              title: 'No source-backed item was extracted',
              message: `No source-backed item was extracted for ${fieldKey.replace('_', ' ')}. This does not prove that the information is absent from the paper.`,
              actionTarget: { type: 'workspace', tab: 'evidence-matrix' },
            }),
          )
        }
      }
    }

    const completeness = assessCitationMetadataCompleteness(paper.citationMetadata)
    if (completeness.status === 'incomplete') {
      findings.push(
        workspaceFinding(paper, {
          id: 'citation-metadata-incomplete',
          kind: 'citation_metadata_incomplete',
          severity: 'info',
          title: 'Citation metadata is incomplete',
          message: `Missing important citation fields: ${completeness.missingImportantFields.join(', ')}.`,
          actionTarget: { type: 'paper', paperId: paper.paperId },
        }),
      )
    }
  }

  const usablePaperIds = papers.filter(hasUsableCurrentMatrix).map((paper) => paper.paperId).sort()
  if (usablePaperIds.length < 2) {
    findings.push({
      id: 'workspace:limited-matrix-coverage',
      scope: 'workspace',
      kind: 'limited_matrix_coverage',
      severity: 'info',
      title: 'Limited multi-paper Evidence Matrix coverage',
      message: 'Fewer than two papers have current, well-formed usable Matrix content. This is a coverage heuristic for multi-paper synthesis, not a research-quality judgment.',
      actionTarget: { type: 'workspace', tab: 'evidence-matrix' },
      relatedPaperIds: usablePaperIds,
      relatedUnitIds: [],
    })
  }

  return finish(findings)
}

function draftFinding(
  id: string,
  kind: string,
  severity: InspectorFinding['severity'],
  title: string,
  message: string,
  relatedUnitIds: string[] = [],
  relatedPaperIds: string[] = [],
): InspectorFinding {
  return { id: `draft:${id}`, scope: 'draft', kind, severity, title, message, relatedUnitIds, relatedPaperIds }
}

function allUnits(input: DraftInspectorInput): GroundedDraftUnit[] {
  return input.draft.paragraphs.flatMap((paragraph) => paragraph.units)
}

export function inspectDraft(input: DraftInspectorInput): InspectorFinding[] {
  const findings: InspectorFinding[] = []
  for (const unit of allUnits(input)) {
    const assessment = input.assessmentsByUnitId[unit.id]
    if (!assessment) {
      findings.push(draftFinding(`unit-${unit.id}-unchecked`, 'claim_unchecked', 'info', 'Claim support has not been checked', 'Support has not been checked.', [unit.id]))
      continue
    }
    const details = {
      unsupported: ['significant', 'Claim is not supported by cited evidence', 'The checked cited evidence does not support this generated statement.'],
      partially_supported: ['attention', 'Claim is only partially supported', 'At least one meaningful part of this generated statement is not fully supported by the cited evidence.'],
      insufficient_evidence: ['attention', 'Cited evidence is insufficient', 'The cited evidence is too incomplete or ambiguous for a reliable support assessment.'],
    } as const
    if (assessment.overallSupport !== 'supported') {
      const [severity, title, message] = details[assessment.overallSupport]
      findings.push(draftFinding(`unit-${unit.id}-${assessment.overallSupport}`, `claim_${assessment.overallSupport}`, severity, title, message, [unit.id], [...new Set(assessment.citations.map((citation) => citation.paperId))].sort()))
    }
  }

  const citedPaperIds = [...new Set(input.draft.citations.map((citation) => citation.paperId))].sort()
  if (citedPaperIds.length === 1) {
    findings.push(draftFinding('single-cited-paper', 'single_cited_paper', 'info', 'Draft cites one paper', 'This draft draws its cited evidence from one paper.', [], citedPaperIds))
  }

  for (const reference of input.draft.references) {
    if (assessCitationMetadataCompleteness(reference.metadata).status === 'incomplete') {
      findings.push(draftFinding(`reference-${reference.paperId}-incomplete`, 'cited_reference_incomplete', 'attention', 'Cited reference metadata is incomplete', 'A cited paper is missing important bibliographic metadata.', [], [reference.paperId]))
    }
  }

  if (citedPaperIds.length >= 2 && input.draft.citations.length >= 3) {
    const counts = new Map<string, number>()
    for (const citation of input.draft.citations) counts.set(citation.paperId, (counts.get(citation.paperId) ?? 0) + 1)
    const concentrated = [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .find(([, count]) => count > input.draft.citations.length / 2)
    if (concentrated) {
      findings.push(draftFinding('citation-concentration', 'citation_concentration', 'info', 'Cited evidence is concentrated', 'Most cited evidence in this draft comes from one paper.', [], [concentrated[0]]))
    }
  }

  return finish(findings)
}
