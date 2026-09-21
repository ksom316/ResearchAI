import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { normalizePaperCitationMetadata } from '#/features/citations/normalize'
import type { ClaimSupportAssessment } from '#/features/claim-checker/types'
import type { GroundedDraft } from '#/features/writer/types'
import { DraftInspectionPanel } from './draft-inspection-panel'

function draft(): GroundedDraft {
  return {
    title: 'Draft',
    mode: 'literature_synthesis',
    paragraphs: [{
      units: [
        { id: 'U1', text: 'First generated statement.', citationIds: ['W1'] },
        { id: 'U2', text: 'Second generated statement.', citationIds: ['W2'] },
        { id: 'U3', text: 'Third generated statement.', citationIds: ['W3'] },
        { id: 'U4', text: 'Fourth generated statement.', citationIds: ['W4'] },
      ],
    }],
    citations: [
      { id: 'W1', paperId: 'p1', paperTitle: 'First paper', locator: { kind: 'chunk', paperId: 'p1', chunkId: 'c1', sectionId: 's1' }, sources: [] },
      { id: 'W2', paperId: 'p1', paperTitle: 'First paper', locator: { kind: 'chunk', paperId: 'p1', chunkId: 'c2', sectionId: 's1' }, sources: [] },
      { id: 'W3', paperId: 'p1', paperTitle: 'First paper', locator: { kind: 'chunk', paperId: 'p1', chunkId: 'c3', sectionId: 's1' }, sources: [] },
      { id: 'W4', paperId: 'p2', paperTitle: 'Second paper', locator: { kind: 'chunk', paperId: 'p2', chunkId: 'c4', sectionId: 's2' }, sources: [] },
    ],
    references: [
      { number: 1, paperId: 'p1', evidenceIds: ['W1', 'W2', 'W3'], metadata: normalizePaperCitationMetadata({ paperId: 'p1', title: 'First paper', authors: ['Author'], publicationYear: 2025 }) },
      { number: 2, paperId: 'p2', evidenceIds: ['W4'], metadata: normalizePaperCitationMetadata({ paperId: 'p2', title: 'Second paper' }) },
    ],
    coverage: { projectPaperCount: 2, selectedPaperCount: 2, participatingPaperCount: 2, unavailablePaperCount: 0, evidenceItemCount: 4 },
  }
}

const assessment = (
  claimId: `U${number}`,
  overallSupport: ClaimSupportAssessment['overallSupport'],
): ClaimSupportAssessment => ({
  claimId,
  overallSupport,
  summary: 'Validated summary',
  unsupportedFragments: [],
  citations: [],
})

describe('Draft inspection panel', () => {
  it('renders unchecked context, deterministic heuristics, and no score or grade', () => {
    const html = renderToStaticMarkup(createElement(DraftInspectionPanel, {
      draft: draft(), assessmentsByUnitId: {},
    }))
    expect(html).toContain('Draft inspection')
    expect(html).toContain('Support has not been checked.')
    expect(html).toContain('Most cited evidence in this draft comes from one paper.')
    expect(html).toContain('Cited reference metadata is incomplete')
    expect(html).toContain('This is not an overall score or grade.')
    expect(html).toContain('First generated statement.')
    expect(html).toContain('Go to draft statement: First generated statement.')
    expect(html).toContain('Review paper')
  })

  it.each([
    ['unsupported', 'Significant', 'Claim is not supported by cited evidence'],
    ['partially_supported', 'Attention', 'Claim is only partially supported'],
    ['insufficient_evidence', 'Attention', 'Cited evidence is insufficient'],
  ] as const)('renders %s as a textual finding', (support, severity, title) => {
    const html = renderToStaticMarkup(createElement(DraftInspectionPanel, {
      draft: draft(), assessmentsByUnitId: { U1: assessment('U1', support) },
    }))
    expect(html).toContain(severity)
    expect(html).toContain(title)
    expect(html).not.toContain('Support has not been checked.</p></li>')
  })

  it('a supported unit removes that unit unchecked finding', () => {
    const value = draft()
    value.paragraphs[0].units = [value.paragraphs[0].units[0]]
    value.citations = [value.citations[0]]
    value.references = [value.references[0]]
    const html = renderToStaticMarkup(createElement(DraftInspectionPanel, {
      draft: value, assessmentsByUnitId: { U1: assessment('U1', 'supported') },
    }))
    expect(html).not.toContain('Support has not been checked.')
    expect(html).toContain('Draft cites one paper')
  })

  it('uses native keyboard-accessible disclosure and mobile-safe wrapping', () => {
    const html = renderToStaticMarkup(createElement(DraftInspectionPanel, {
      draft: draft(), assessmentsByUnitId: {},
    }))
    expect(html).toContain('<details')
    expect(html).toContain('<summary')
    expect(html).toContain('break-words')
    expect(html).toContain('min-w-0')
  })

  it('preserves Claim Checker selectors, paper numbering, copy, and lazy provenance', () => {
    const grounded = readFileSync('src/features/writer/ui/grounded-draft-view.tsx', 'utf8')
    const checker = readFileSync('src/features/claim-checker/ui/claim-check-button.tsx', 'utf8')
    const writer = readFileSync('src/features/writer/ui/academic-writer-tab.tsx', 'utf8')
    expect(grounded).toContain('unit.citationIds.flatMap')
    expect(checker).toContain('citationId: citation.id')
    expect(checker).toContain('locator: citation.locator')
    expect(grounded).toContain('groupUnitCitationsByPaper')
    expect(grounded).toContain('formatDraftForCopy(draft)')
    expect(grounded).toContain('onSelectCitation')
    expect(writer).toContain('applyClaimCheckResult')
    expect(writer).toContain('draftEpoch')
  })
})
