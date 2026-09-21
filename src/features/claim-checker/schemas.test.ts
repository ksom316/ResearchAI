import { describe, expect, it } from 'vitest'
import { claimCheckRequestSchema } from './schemas'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const PAPER = '22222222-2222-4222-8222-222222222222'
const CHUNK = '33333333-3333-4333-8333-333333333333'
const SECTION = '44444444-4444-4444-8444-444444444444'

const citation = {
  citationId: 'W1',
  locator: {
    kind: 'chunk',
    paperId: PAPER,
    chunkId: CHUNK,
    sectionId: SECTION,
  },
}
const valid = {
  projectId: PROJECT,
  claimId: 'U1',
  claimText: '  A grounded claim.  ',
  citations: [citation],
}

describe('Claim Checker request schema', () => {
  it('normalizes the strict one-unit request', () => {
    expect(claimCheckRequestSchema.parse(valid)).toMatchObject({
      projectId: PROJECT,
      claimId: 'U1',
      claimText: 'A grounded claim.',
      citations: [citation],
    })
  })

  it.each([
    ['invalid UUID', { ...valid, projectId: 'not-a-uuid' }],
    ['invalid U id', { ...valid, claimId: 'U11' }],
    ['empty claim', { ...valid, claimText: '   ' }],
    ['oversized claim', { ...valid, claimText: 'x'.repeat(451) }],
    ['no citations', { ...valid, citations: [] }],
    [
      'more than four citations',
      {
        ...valid,
        citations: Array.from({ length: 5 }, (_, index) => ({
          citationId: `W${index + 1}`,
          locator: {
            kind: 'extraction_claim',
            paperId: PAPER,
            schemaVersion: 1,
            fieldKey: 'findings',
            itemIndex: index,
          },
        })),
      },
    ],
    [
      'duplicate W ids',
      {
        ...valid,
        citations: [citation, { ...citation, locator: { ...citation.locator, chunkId: PROJECT } }],
      },
    ],
    [
      'duplicate locators',
      { ...valid, citations: [citation, { ...citation, citationId: 'W2' }] },
    ],
    ['top-level extra field', { ...valid, evidence: 'forged' }],
    [
      'citation extra field',
      { ...valid, citations: [{ ...citation, excerpt: 'forged' }] },
    ],
    [
      'locator extra field',
      {
        ...valid,
        citations: [
          { ...citation, locator: { ...citation.locator, paperTitle: 'forged' } },
        ],
      },
    ],
  ])('rejects %s', (_name, request) => {
    expect(claimCheckRequestSchema.safeParse(request).success).toBe(false)
  })

  it.each([
    'userId',
    'provider',
    'model',
    'prompt',
    'maxTokens',
    'retrievalLimit',
    'assessment',
    'confidence',
    'sourceRecords',
  ])('rejects forbidden browser field %s', (field) => {
    expect(
      claimCheckRequestSchema.safeParse({ ...valid, [field]: 'forged' })
        .success,
    ).toBe(false)
  })
})
