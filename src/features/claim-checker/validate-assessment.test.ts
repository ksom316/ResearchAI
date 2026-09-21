import { describe, expect, it } from 'vitest'
import type {
  ClaimCheckEvidencePacket,
  NormalizedClaimCheckRequest,
} from './types'
import { validateClaimAssessment } from './validate-assessment'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222222'
const P2 = '33333333-3333-4333-8333-333333333333'
const claim = 'The model uses a CNN encoder and achieves 99% accuracy.'
const locator = (paperId: string, itemIndex: number) => ({
  kind: 'extraction_claim' as const,
  paperId,
  schemaVersion: 1,
  fieldKey: 'findings' as const,
  itemIndex,
})
const request: NormalizedClaimCheckRequest = {
  projectId: PROJECT,
  claimId: 'U1',
  claimText: claim,
  citations: [
    { citationId: 'W1', locator: locator(P1, 0) },
    { citationId: 'W2', locator: locator(P2, 0) },
  ],
}
const evidence: ClaimCheckEvidencePacket = {
  claimText: claim,
  totalPromptEvidenceChars: 100,
  items: request.citations.map((citation, index) => ({
    id: `C${index + 1}`,
    writerCitationId: citation.citationId,
    locator: citation.locator,
    paperId: citation.locator.paperId,
    paperTitle: `Paper ${index + 1}`,
    claimText: 'Evidence claim.',
    sourceRecords: [],
    promptText: 'Evidence.',
  })),
}
const citation = (evidence_id: string, support: string) => ({
  evidence_id,
  support,
  rationale: 'Short evidence-specific rationale.',
})
const output = (overrides: Record<string, unknown> = {}) => ({
  overall_support: 'supported',
  summary: 'The complete claim is supported by the evidence set.',
  unsupported_fragments: [],
  citation_assessments: [
    citation('C1', 'supported'),
    citation('C2', 'unsupported'),
  ],
  ...overrides,
})

describe('Claim Checker assessment validation', () => {
  it.each([
    ['direct support', output()],
    [
      'partial compound claim',
      output({
        overall_support: 'partially_supported',
        unsupported_fragments: ['achieves 99% accuracy'],
        citation_assessments: [
          citation('C1', 'partially_supported'),
          citation('C2', 'unsupported'),
        ],
      }),
    ],
    [
      'unsupported claim',
      output({
        overall_support: 'unsupported',
        unsupported_fragments: [claim],
        citation_assessments: [
          citation('C1', 'unsupported'),
          citation('C2', 'unsupported'),
        ],
      }),
    ],
    [
      'insufficient evidence',
      output({
        overall_support: 'insufficient_evidence',
        citation_assessments: [
          citation('C1', 'insufficient_evidence'),
          citation('C2', 'unsupported'),
        ],
      }),
    ],
    [
      'complementary partial citations',
      output({
        citation_assessments: [
          citation('C1', 'partially_supported'),
          citation('C2', 'partially_supported'),
        ],
      }),
    ],
    ['one strong and one weak citation', output()],
    [
      'one citation supports a proposition while a topical citation is unsupported',
      output({
        overall_support: 'partially_supported',
        summary:
          'The architecture is supported, but the reported accuracy is not.',
        unsupported_fragments: ['achieves 99% accuracy'],
        citation_assessments: [
          {
            ...citation('C1', 'partially_supported'),
            rationale: 'Directly supports the CNN encoder proposition.',
          },
          {
            ...citation('C2', 'unsupported'),
            rationale:
              'Mentions the research topic but substantiates no claim proposition.',
          },
        ],
      }),
    ],
  ])('accepts %s', (_name, modelOutput) => {
    expect(validateClaimAssessment(modelOutput, { request, evidence }).ok).toBe(true)
  })

  it('returns server-owned metadata in deterministic packet order', () => {
    const reversed = output({
      citation_assessments: [
        citation('C2', 'unsupported'),
        citation('C1', 'supported'),
      ],
    })
    const result = validateClaimAssessment(reversed, { request, evidence })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.assessment.claimId).toBe('U1')
    expect(result.assessment.citations.map((entry) => entry.citationId)).toEqual([
      'W1',
      'W2',
    ])
    expect(result.assessment.citations[0]).toMatchObject({
      paperId: P1,
      paperTitle: 'Paper 1',
      locator: locator(P1, 0),
    })
  })

  it.each([
    ['invented C id', output({ citation_assessments: [citation('C1', 'supported'), citation('C3', 'unsupported')] })],
    ['duplicate C id', output({ citation_assessments: [citation('C1', 'supported'), citation('C1', 'unsupported')] })],
    ['missing C id/count mismatch', output({ citation_assessments: [citation('C1', 'supported')] })],
    ['unsupported fragment not in claim', output({ overall_support: 'partially_supported', unsupported_fragments: ['uses a recurrent network'], citation_assessments: [citation('C1', 'partially_supported'), citation('C2', 'unsupported')] })],
    ['supported with unsupported fragment', output({ unsupported_fragments: ['99% accuracy'] })],
    ['supported with no supporting citation', output({ citation_assessments: [citation('C1', 'unsupported'), citation('C2', 'unsupported')] })],
    ['supported when one citation covers only part and the other is topical', output({ citation_assessments: [citation('C1', 'partially_supported'), citation('C2', 'unsupported')] })],
    ['partial without fragment', output({ overall_support: 'partially_supported', citation_assessments: [citation('C1', 'partially_supported'), citation('C2', 'unsupported')] })],
    ['partial without supportive citation', output({ overall_support: 'partially_supported', unsupported_fragments: ['99% accuracy'], citation_assessments: [citation('C1', 'unsupported'), citation('C2', 'insufficient_evidence')] })],
    ['unsupported with supported citation', output({ overall_support: 'unsupported', unsupported_fragments: [claim], citation_assessments: [citation('C1', 'supported'), citation('C2', 'unsupported')] })],
    ['insufficient with supported citation', output({ overall_support: 'insufficient_evidence' })],
    ['Markdown rationale', output({ citation_assessments: [{ ...citation('C1', 'supported'), rationale: '**Supported**' }, citation('C2', 'unsupported')] })],
    ['HTML summary', output({ summary: '<strong>Supported</strong>' })],
    ['Writer id in rationale', output({ citation_assessments: [{ ...citation('C1', 'supported'), rationale: 'Supported by W1.' }, citation('C2', 'unsupported')] })],
  ])('rejects invalid assessment: %s', (_name, modelOutput) => {
    expect(validateClaimAssessment(modelOutput, { request, evidence })).toEqual({
      ok: false,
      error: 'invalid_assessment',
    })
  })

  it.each([
    ['malformed response', { overall_support: 'supported' }],
    ['malformed enum', output({ overall_support: 'mostly_supported' })],
    ['extra field', { ...output(), confidence: 0.9 }],
    ['oversized summary', output({ summary: 's'.repeat(301) })],
    ['oversized rationale', output({ citation_assessments: [{ ...citation('C1', 'supported'), rationale: 'r'.repeat(241) }, citation('C2', 'unsupported')] })],
  ])('rejects invalid structured output: %s', (_name, modelOutput) => {
    expect(validateClaimAssessment(modelOutput, { request, evidence })).toEqual({
      ok: false,
      error: 'invalid_output',
    })
  })
})
