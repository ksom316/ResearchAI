import { describe, expect, it } from 'vitest'
import { normalizePaperCitationMetadata } from '#/features/citations/normalize'
import type { ExtractionField, ExtractionOverview } from '#/features/evidence-matrix/types'
import type { GroundedDraft } from '#/features/writer/types'
import type { ClaimSupportAssessment } from '#/features/claim-checker/types'
import { inspectDraft, inspectWorkspace } from './inspect'
import type { WorkspaceInspectorPaper } from './types'

const now = '2026-01-01T00:00:00.000Z'

function overview(
  status: ExtractionOverview['status'] = 'complete',
  isStale = false,
): ExtractionOverview {
  return {
    paperId: 'p1', schemaVersion: 1, status, isStale,
    sourceCompletedAt: now, completedAt: now, provider: null, model: null,
    createdAt: now, updatedAt: now,
  }
}

function field(
  fieldKey: ExtractionField['fieldKey'],
  state: ExtractionField['state'] = 'extracted',
  itemsMalformed = false,
): ExtractionField {
  return {
    paperId: 'p1', schemaVersion: 1, fieldKey, state, itemsMalformed,
    items: state === 'extracted' ? [{ text: 'Usable evidence' }] : [],
    createdAt: now, updatedAt: now,
  }
}

const allFields = (): ExtractionField[] => [
  'objective', 'methodology', 'dataset', 'findings', 'limitations',
  'future_work', 'concepts',
].map((key) => field(key as ExtractionField['fieldKey']))

function paper(
  paperId: string,
  overrides: Partial<WorkspaceInspectorPaper> = {},
): WorkspaceInspectorPaper {
  return {
    paperId,
    title: `Paper ${paperId}`,
    status: 'ready',
    citationMetadata: normalizePaperCitationMetadata({
      paperId, title: `Paper ${paperId}`, authors: ['Author'], publicationYear: 2025,
    }),
    searchCoverage: { paperId, paperTitle: `Paper ${paperId}`, state: 'searchable', chunkCount: 2 },
    matrixOverview: { ...overview(), paperId },
    matrixFields: allFields().map((value) => ({ ...value, paperId })),
    ...overrides,
  }
}

function kinds(result: ReturnType<typeof inspectWorkspace>) {
  return result.map((finding) => finding.kind)
}

describe('workspace quality inspector', () => {
  it('reports processing and indexing states with the approved severities', () => {
    const result = inspectWorkspace({ papers: [
      paper('failed', { status: 'failed' }),
      paper('processing', { status: 'processing', searchCoverage: { paperId: 'processing', paperTitle: 'Processing', state: 'indexing', chunkCount: 2 } }),
      paper('stale-index', { searchCoverage: { paperId: 'stale-index', paperTitle: 'Stale', state: 'index_stale', chunkCount: 2 } }),
      paper('not-indexed', { searchCoverage: { paperId: 'not-indexed', paperTitle: 'None', state: 'not_indexed', chunkCount: 2 } }),
      paper('index-failed', { searchCoverage: { paperId: 'index-failed', paperTitle: 'Failed', state: 'index_failed', chunkCount: 2 } }),
      paper('pending', { searchCoverage: { paperId: 'pending', paperTitle: 'Pending', state: 'index_pending', chunkCount: 2 } }),
    ] })
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'processing_failed', severity: 'significant' }),
      expect.objectContaining({ kind: 'processing_incomplete', severity: 'info' }),
      expect.objectContaining({ kind: 'search_indexing', severity: 'info' }),
      expect.objectContaining({ kind: 'search_index_pending', severity: 'info' }),
      expect.objectContaining({ kind: 'search_index_stale', severity: 'attention' }),
      expect.objectContaining({ kind: 'search_not_indexed', severity: 'attention' }),
      expect.objectContaining({ kind: 'search_index_failed', severity: 'attention' }),
    ]))
  })

  it('distinguishes missing, failed, stale, and partial Matrix state', () => {
    const result = inspectWorkspace({ papers: [
      paper('missing', { matrixOverview: null, matrixFields: [] }),
      paper('failed', { matrixOverview: { ...overview('failed'), paperId: 'failed' } }),
      paper('stale', { matrixOverview: { ...overview('complete', true), paperId: 'stale' } }),
      paper('partial', { matrixOverview: { ...overview('partial'), paperId: 'partial' } }),
    ] })
    expect(kinds(result)).toEqual(expect.arrayContaining(['matrix_missing', 'matrix_failed', 'matrix_stale', 'matrix_partial']))
  })

  it('reports unusable fields and describes not_reported without claiming absence', () => {
    const fields = allFields()
    fields[0] = field('objective', 'not_reported')
    fields[1] = field('methodology', 'failed')
    fields[2] = field('dataset', 'extracted', true)
    fields.pop()
    const result = inspectWorkspace({ papers: [paper('p1', { matrixFields: fields }), paper('p2')] })
    const notReported = result.find((finding) => finding.kind === 'matrix_field_not_reported')
    expect(notReported?.severity).toBe('info')
    expect(notReported?.message).toContain('No source-backed item was extracted')
    expect(notReported?.message).toContain('does not prove that the information is absent')
    expect(result.filter((finding) => finding.kind === 'matrix_field_unusable')).toHaveLength(3)
  })

  it('reports incomplete citation metadata and limited coverage as a heuristic', () => {
    const result = inspectWorkspace({ papers: [paper('p1', {
      citationMetadata: normalizePaperCitationMetadata({ paperId: 'p1', title: 'Title' }),
    })] })
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'citation_metadata_incomplete', severity: 'info' }),
      expect.objectContaining({ kind: 'limited_matrix_coverage', severity: 'info', message: expect.stringContaining('coverage heuristic') }),
    ]))
  })

  it('does not report limited coverage with two current usable papers', () => {
    expect(kinds(inspectWorkspace({ papers: [paper('p1'), paper('p2')] }))).not.toContain('limited_matrix_coverage')
  })

  it('suppresses duplicate papers, is deterministic, and does not mutate input', () => {
    const input = { papers: [paper('p2'), paper('p1', { status: 'failed' }), paper('p1', { status: 'failed' })] }
    const snapshot = structuredClone(input)
    const first = inspectWorkspace(input)
    const second = inspectWorkspace({ papers: [...input.papers].reverse() })
    expect(first.filter((finding) => finding.kind === 'processing_failed')).toHaveLength(1)
    expect(first.map((finding) => finding.id)).toEqual(second.map((finding) => finding.id))
    expect(input).toEqual(snapshot)
  })
})

function draft(): GroundedDraft {
  const metadata = (paperId: string, complete = true) => normalizePaperCitationMetadata({
    paperId, title: `Paper ${paperId}`, authors: complete ? ['Author'] : [], publicationYear: complete ? 2025 : null,
  })
  return {
    title: 'Draft', mode: 'literature_synthesis', coverage: { projectPaperCount: 2, selectedPaperCount: 2, participatingPaperCount: 2, unavailablePaperCount: 0, evidenceItemCount: 4 },
    paragraphs: [{ units: [
      { id: 'U1', text: 'One', citationIds: ['W1', 'W2'] },
      { id: 'U2', text: 'Two', citationIds: ['W3'] },
      { id: 'U3', text: 'Three', citationIds: ['W4'] },
      { id: 'U4', text: 'Four', citationIds: ['W1'] },
    ] }],
    citations: [
      { id: 'W1', paperId: 'p1', paperTitle: 'P1', locator: { kind: 'chunk', paperId: 'p1', chunkId: 'c1', sectionId: 's1' }, sources: [] },
      { id: 'W2', paperId: 'p1', paperTitle: 'P1', locator: { kind: 'chunk', paperId: 'p1', chunkId: 'c2', sectionId: 's1' }, sources: [] },
      { id: 'W3', paperId: 'p1', paperTitle: 'P1', locator: { kind: 'chunk', paperId: 'p1', chunkId: 'c3', sectionId: 's1' }, sources: [] },
      { id: 'W4', paperId: 'p2', paperTitle: 'P2', locator: { kind: 'chunk', paperId: 'p2', chunkId: 'c4', sectionId: 's2' }, sources: [] },
    ],
    references: [
      { number: 1, paperId: 'p1', metadata: metadata('p1'), evidenceIds: ['W1', 'W2', 'W3'] },
      { number: 2, paperId: 'p2', metadata: metadata('p2', false), evidenceIds: ['W4'] },
    ],
  }
}

function assessment(unitId: `U${number}`, support: ClaimSupportAssessment['overallSupport']): ClaimSupportAssessment {
  return { claimId: unitId, overallSupport: support, summary: 'Summary', unsupportedFragments: [], citations: [] }
}

describe('draft quality inspector', () => {
  it('reports unsupported, partial, insufficient, and unchecked units', () => {
    const result = inspectDraft({ draft: draft(), assessmentsByUnitId: {
      U1: assessment('U1', 'unsupported'),
      U2: assessment('U2', 'partially_supported'),
      U3: assessment('U3', 'insufficient_evidence'),
    } })
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'claim_unsupported', severity: 'significant', relatedUnitIds: ['U1'] }),
      expect.objectContaining({ kind: 'claim_partially_supported', severity: 'attention', relatedUnitIds: ['U2'] }),
      expect.objectContaining({ kind: 'claim_insufficient_evidence', severity: 'attention', relatedUnitIds: ['U3'] }),
      expect.objectContaining({ kind: 'claim_unchecked', severity: 'info', relatedUnitIds: ['U4'] }),
    ]))
  })

  it('reports incomplete cited references and strict-majority concentration', () => {
    const result = inspectDraft({ draft: draft(), assessmentsByUnitId: {} })
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'cited_reference_incomplete', relatedPaperIds: ['p2'] }),
      expect.objectContaining({ kind: 'citation_concentration', message: 'Most cited evidence in this draft comes from one paper.' }),
    ]))
  })

  it('reports a single cited paper', () => {
    const value = draft()
    value.citations = value.citations.filter((citation) => citation.paperId === 'p1')
    value.references = value.references.filter((reference) => reference.paperId === 'p1')
    expect(inspectDraft({ draft: value, assessmentsByUnitId: {} })).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'single_cited_paper', severity: 'info' }),
    ]))
  })

  it('requires at least three evidence citations and a strict majority for concentration', () => {
    const two = draft()
    two.citations = [two.citations[0], two.citations[3]]
    expect(inspectDraft({ draft: two, assessmentsByUnitId: {} }).some((finding) => finding.kind === 'citation_concentration')).toBe(false)

    const tied = draft()
    tied.citations = [
      ...tied.citations,
      { ...tied.citations[3], id: 'W5', locator: { kind: 'chunk', paperId: 'p2', chunkId: 'c5', sectionId: 's2' } },
      { ...tied.citations[3], id: 'W6', locator: { kind: 'chunk', paperId: 'p2', chunkId: 'c6', sectionId: 's2' } },
    ]
    expect(inspectDraft({ draft: tied, assessmentsByUnitId: {} }).some((finding) => finding.kind === 'citation_concentration')).toBe(false)
  })

  it('is deterministic and does not mutate the draft or assessments', () => {
    const input = { draft: draft(), assessmentsByUnitId: { U1: assessment('U1', 'supported') } }
    const snapshot = structuredClone(input)
    const first = inspectDraft(input)
    const second = inspectDraft(input)
    expect(first.map((finding) => finding.id)).toEqual(second.map((finding) => finding.id))
    expect(input).toEqual(snapshot)
  })
})
