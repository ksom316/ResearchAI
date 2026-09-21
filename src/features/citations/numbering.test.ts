import { describe, expect, it } from 'vitest'
import {
  derivePaperReferenceNumbering,
  referenceNumbersForEvidence,
} from './numbering'
import type { CitationDraftUsage } from './types'

const draft: CitationDraftUsage = {
  paragraphs: [
    {
      units: [
        { text: 'One', citationIds: ['W3', 'W1'] },
        { text: 'Two', citationIds: ['W2', 'W3'] },
      ],
    },
    {
      units: [{ text: 'Three', citationIds: ['W4', 'W1'] }],
    },
  ],
  citations: [
    { id: 'W1', paperId: 'paper-a' },
    { id: 'W2', paperId: 'paper-b' },
    { id: 'W3', paperId: 'paper-a' },
    { id: 'W4', paperId: 'paper-c' },
    { id: 'W99', paperId: 'uncited-paper' },
  ],
}

describe('paper-level reference numbering', () => {
  it('numbers papers by first draft use rather than citation metadata order', () => {
    const result = derivePaperReferenceNumbering(draft)
    expect(result.references.map(({ paperId, number }) => ({ paperId, number }))).toEqual([
      { paperId: 'paper-a', number: 1 },
      { paperId: 'paper-b', number: 2 },
      { paperId: 'paper-c', number: 3 },
    ])
  })

  it('collapses same-paper W ids to one number without deleting evidence ids', () => {
    const result = derivePaperReferenceNumbering(draft)
    expect(result.numberByEvidenceId.get('W3')).toBe(1)
    expect(result.numberByEvidenceId.get('W1')).toBe(1)
    expect(result.references[0]).toEqual({
      paperId: 'paper-a',
      number: 1,
      evidenceIds: ['W3', 'W1'],
    })
  })

  it('preserves distinct evidence order and avoids duplicates across units', () => {
    const result = derivePaperReferenceNumbering(draft)
    expect(result.references.map((reference) => reference.evidenceIds)).toEqual([
      ['W3', 'W1'],
      ['W2'],
      ['W4'],
    ])
  })

  it('never includes uncited papers or evidence', () => {
    const result = derivePaperReferenceNumbering(draft)
    expect(result.numberByPaperId.has('uncited-paper')).toBe(false)
    expect(result.numberByEvidenceId.has('W99')).toBe(false)
  })

  it('collapses same-paper evidence into one visible unit marker', () => {
    const result = derivePaperReferenceNumbering(draft)
    expect(referenceNumbersForEvidence(['W3', 'W1'], result)).toEqual([1])
    expect(referenceNumbersForEvidence(['W2', 'W3'], result)).toEqual([2, 1])
  })

  it('is deterministic for identical input and skips unresolved evidence safely', () => {
    const first = derivePaperReferenceNumbering(draft)
    const second = derivePaperReferenceNumbering(draft)
    expect(first.references).toEqual(second.references)
    expect(
      referenceNumbersForEvidence(['missing', 'W4', 'missing'], first),
    ).toEqual([3])
  })
})
