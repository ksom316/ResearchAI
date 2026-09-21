import { describe, expect, it } from 'vitest'
import { attachGroundedDraftReferences, citedPaperIds } from './references'
import type { ValidatedGroundedDraft } from './types'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

const draft: ValidatedGroundedDraft = {
  title: 'Synthesis',
  mode: 'findings_synthesis',
  paragraphs: [
    { units: [{ id: 'U1', text: 'First.', citationIds: ['W2', 'W1'] }] },
    { units: [{ id: 'U2', text: 'Second.', citationIds: ['W3', 'W2'] }] },
  ],
  citations: [
    { id: 'W2', paperId: P1, paperTitle: 'Paper one', locator: { kind: 'chunk', paperId: P1, chunkId: 'c2', sectionId: 's1' }, sources: [] },
    { id: 'W1', paperId: P1, paperTitle: 'Paper one', locator: { kind: 'chunk', paperId: P1, chunkId: 'c1', sectionId: 's1' }, sources: [] },
    { id: 'W3', paperId: P2, paperTitle: 'Paper two', locator: { kind: 'chunk', paperId: P2, chunkId: 'c3', sectionId: 's2' }, sources: [] },
  ],
  coverage: {
    projectPaperCount: 3, selectedPaperCount: 0, participatingPaperCount: 2,
    unavailablePaperCount: 1, evidenceItemCount: 3,
  },
}

describe('Writer paper reference construction', () => {
  it('uses first paper use, deduplicates papers, and preserves every W identity', () => {
    const result = attachGroundedDraftReferences(draft, [
      {
        paperId: P2, title: 'Citation two', authors: [], publicationYear: null,
        containerTitle: null, publisher: null, doi: null, url: null,
        volume: null, issue: null, pages: null,
      },
      {
        paperId: P1, title: 'Citation one', authors: ['A'], publicationYear: 2024,
        containerTitle: null, publisher: null, doi: null, url: null,
        volume: null, issue: null, pages: null,
      },
      {
        paperId: 'uncited', title: 'Uncited', authors: [], publicationYear: null,
        containerTitle: null, publisher: null, doi: null, url: null,
        volume: null, issue: null, pages: null,
      },
    ])
    expect(result.references).toEqual([
      expect.objectContaining({ number: 1, paperId: P1, evidenceIds: ['W2', 'W1'] }),
      expect.objectContaining({ number: 2, paperId: P2, evidenceIds: ['W3'] }),
    ])
    expect(result.references.map((entry) => entry.metadata.title)).toEqual([
      'Citation one',
      'Citation two',
    ])
    expect(result.citations).toBe(draft.citations)
  })

  it('loads only cited papers and falls back honestly to the authorized paper title', () => {
    expect(citedPaperIds(draft)).toEqual([P1, P2])
    const result = attachGroundedDraftReferences(draft, [])
    expect(result.references[0].metadata).toMatchObject({
      paperId: P1,
      title: 'Paper one',
      authors: [],
      publicationYear: null,
    })
  })
})
