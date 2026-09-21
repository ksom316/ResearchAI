import { describe, expect, it } from 'vitest'
import {
  buildWriterRequest,
  citationNumberMap,
  formatDraftForCopy,
  groupUnitCitationsByPaper,
  toggleWriterPaper,
  WRITER_ERROR_MESSAGES,
  WRITER_MODE_OPTIONS,
  writerResultMessage,
} from './presentation'
import type { GroundedDraft } from './types'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222222'
const P2 = '33333333-3333-4333-8333-333333333333'

const draft: GroundedDraft = {
  title: 'Study comparison',
  mode: 'compare_studies',
  paragraphs: [
    {
      units: [
        { id: 'U1', text: 'First statement.', citationIds: ['W2', 'W1'] },
        { id: 'U2', text: 'Second statement.', citationIds: ['W2'] },
      ],
    },
  ],
  citations: [
    {
      id: 'W2', paperId: P2, paperTitle: 'Two',
      locator: { kind: 'chunk', paperId: P2, chunkId: P2, sectionId: P1 }, sources: [],
    },
    {
      id: 'W1', paperId: P1, paperTitle: 'One',
      locator: { kind: 'chunk', paperId: P1, chunkId: P1, sectionId: P2 }, sources: [],
    },
  ],
  references: [
    {
      number: 1,
      paperId: P2,
      evidenceIds: ['W2'],
      metadata: {
        paperId: P2, title: 'Two', authors: ['Author Two'], publicationYear: 2025,
        containerTitle: null, publisher: null, doi: null, url: null,
        volume: null, issue: null, pages: null,
      },
    },
    {
      number: 2,
      paperId: P1,
      evidenceIds: ['W1'],
      metadata: {
        paperId: P1, title: 'One', authors: [], publicationYear: null,
        containerTitle: null, publisher: null, doi: null, url: null,
        volume: null, issue: null, pages: null,
      },
    },
  ],
  coverage: {
    projectPaperCount: 2, selectedPaperCount: 2, participatingPaperCount: 2,
    unavailablePaperCount: 0, evidenceItemCount: 2,
  },
}

describe('Writer presentation', () => {
  it('exposes exactly the five supported modes without a gap selector mode', () => {
    expect(WRITER_MODE_OPTIONS.map((option) => option.value)).toEqual([
      'literature_synthesis', 'compare_studies', 'methodology_summary',
      'findings_synthesis', 'limitations_future_work',
    ])
  })

  it('requires a literature focus and sends only the allowed fields', () => {
    expect(buildWriterRequest(PROJECT, { mode: 'literature_synthesis', focus: ' ', paperIds: [P1] })).toBeNull()
    expect(buildWriterRequest(PROJECT, { mode: 'literature_synthesis', focus: '  table methods  ', paperIds: [P1] })).toEqual({
      projectId: PROJECT, mode: 'literature_synthesis', focus: 'table methods',
    })
  })

  it('requires 2–5 unique papers for comparison and deterministically sorts ids', () => {
    expect(buildWriterRequest(PROJECT, { mode: 'compare_studies', focus: '', paperIds: [P1] })).toBeNull()
    expect(buildWriterRequest(PROJECT, { mode: 'compare_studies', focus: '', paperIds: [P2, P1] })).toEqual({
      projectId: PROJECT, mode: 'compare_studies', paperIds: [P1, P2],
    })
  })

  it('omits paperIds for optional all-project modes', () => {
    expect(buildWriterRequest(PROJECT, { mode: 'findings_synthesis', focus: '', paperIds: [] })).toEqual({
      projectId: PROJECT, mode: 'findings_synthesis',
    })
  })

  it('enforces the selection maximum and allows deselection', () => {
    const five = ['1', '2', '3', '4', '5']
    expect(toggleWriterPaper(five, '6')).toEqual(five)
    expect(toggleWriterPaper(five, '3')).toEqual(['1', '2', '4', '5'])
  })

  it('uses one global citation number in server first-use metadata order', () => {
    expect([...citationNumberMap(draft)]).toEqual([['W2', 1], ['W1', 2]])
    expect(formatDraftForCopy(draft)).toBe(
      'First statement. [1] [2] Second statement. [1]\n\nReferences\n\n[1] Author Two, “Two,” 2025.\n[2] “One.”',
    )
    expect(formatDraftForCopy(draft)).not.toMatch(/W\d|U\d/)
    expect(formatDraftForCopy(draft)).not.toContain('Uncited')
  })

  it('collapses same-paper markers while preserving distinct evidence objects', () => {
    const samePaper = {
      ...draft,
      citations: draft.citations.map((citation) => ({
        ...citation,
        paperId: P2,
        paperTitle: 'Two',
        locator: { ...citation.locator, paperId: P2 },
      })),
      references: [{ ...draft.references[0], evidenceIds: ['W2', 'W1'] as ['W2', 'W1'] }],
    } satisfies GroundedDraft
    expect([...citationNumberMap(samePaper)]).toEqual([['W2', 1], ['W1', 1]])
    const groups = groupUnitCitationsByPaper(samePaper, ['W2', 'W1'])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ number: 1, paperId: P2 })
    expect(groups[0].citations.map((citation) => citation.id)).toEqual(['W2', 'W1'])
    expect(formatDraftForCopy(samePaper)).toContain('First statement. [1]')
    expect(formatDraftForCopy(samePaper).match(/^\[1\]/gm)).toHaveLength(1)
  })

  it('maps abstentions and rejected output to safe fixed messages', () => {
    expect(writerResultMessage({ ok: false, error: 'invalid_citation' })).toContain('Nothing was displayed')
    expect(WRITER_ERROR_MESSAGES.writer_timeout).not.toContain('provider')
  })
})
