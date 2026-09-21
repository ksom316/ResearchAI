import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '#/lib/llm'
import type {
  LlmProvider,
  StructuredRequest,
  StructuredResult,
} from '#/lib/llm'
import type { WriterDb } from '#/features/writer/writer-db.server'
import {
  assessClaimSupport,
  CLAIM_CHECK_REASONING,
  MAX_CLAIM_CHECK_OUTPUT_TOKENS,
} from './assessment-service'
import { CLAIM_CHECK_JSON_SCHEMA } from './model-schema'
import type { ClaimCheckEvidenceResult } from './types'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const PAPER = '22222222-2222-4222-8222-222222222222'
const locator = {
  kind: 'extraction_claim' as const,
  paperId: PAPER,
  schemaVersion: 1,
  fieldKey: 'findings' as const,
  itemIndex: 0,
}
const ready: ClaimCheckEvidenceResult = {
  ok: true,
  status: 'ready',
  request: {
    projectId: PROJECT,
    claimId: 'U1',
    claimText: 'The model achieves 99% accuracy.',
    citations: [{ citationId: 'W1', locator }],
  },
  evidence: {
    claimText: 'The model achieves 99% accuracy.',
    totalPromptEvidenceChars: 40,
    items: [
      {
        id: 'C1',
        writerCitationId: 'W1',
        locator,
        paperId: PAPER,
        paperTitle: 'Server Paper',
        claimText: 'The model achieves 99% accuracy.',
        sourceRecords: [],
        promptText: 'The paper reports 99% accuracy.',
      },
    ],
  },
}
const generated = {
  overall_support: 'supported',
  summary: 'The cited evidence explicitly reports the stated result.',
  unsupported_fragments: [],
  citation_assessments: [
    { evidence_id: 'C1', support: 'supported', rationale: 'The result is directly reported.' },
  ],
}
const result = (
  data: Record<string, unknown>,
  finishReason: string | null = 'stop',
): StructuredResult => ({
  data,
  usage: { inputTokens: 500, outputTokens: 100, totalTokens: 600 },
  provider: 'openrouter',
  model: 'vendor/free:free',
  finishReason,
})
function provider(
  implementation: (request: StructuredRequest) => Promise<StructuredResult>,
) {
  const generateStructured = vi.fn(implementation)
  return {
    llm: { generateStructured } satisfies LlmProvider,
    generateStructured,
  }
}
const db = {} as WriterDb

describe('Claim Checker assessment service', () => {
  it('makes exactly one strict, bounded, no-reasoning provider call', async () => {
    const fake = provider(async () => result(generated))
    const getLlm = vi.fn(() => fake.llm)
    const outcome = await assessClaimSupport({}, {
      db,
      prepareEvidence: async () => ready,
      getLlm,
      nonce: () => 'fixed-nonce',
    })
    expect(outcome).toMatchObject({ ok: true, status: 'assessed' })
    expect(getLlm).toHaveBeenCalledOnce()
    expect(fake.generateStructured).toHaveBeenCalledOnce()
    const call = fake.generateStructured.mock.calls[0][0]
    expect(call.schema).toBe(CLAIM_CHECK_JSON_SCHEMA)
    expect(call.maxTokens).toBe(MAX_CLAIM_CHECK_OUTPUT_TOKENS)
    expect(call.maxTokens).toBe(1_200)
    expect(call.reasoning).toEqual(CLAIM_CHECK_REASONING)
    expect(call.reasoning).toEqual({ effort: 'none' })
    expect(call.user).toContain('AUTHORIZED EVIDENCE IDS: C1')
    expect(call.user).not.toContain('W1')
  })

  it('accepts provider-returned insufficient evidence as a legitimate assessment', async () => {
    const fake = provider(async () =>
      result({
        overall_support: 'insufficient_evidence',
        summary: 'The supplied passage is too ambiguous to assess the result.',
        unsupported_fragments: [],
        citation_assessments: [
          {
            evidence_id: 'C1',
            support: 'insufficient_evidence',
            rationale: 'The passage lacks enough result detail.',
          },
        ],
      }),
    )
    const outcome = await assessClaimSupport({}, {
      db,
      prepareEvidence: async () => ready,
      getLlm: () => fake.llm,
    })
    expect(outcome).toMatchObject({
      ok: true,
      status: 'assessed',
      assessment: { overallSupport: 'insufficient_evidence' },
    })
  })

  it.each([
    ['stale_evidence', 'The cited evidence is out of date'],
    ['evidence_missing', 'no longer available'],
    ['paper_not_ready', 'not currently ready'],
    ['no_usable_source', 'enough usable source text'],
    ['evidence_budget_exceeded', 'too large'],
  ] as const)('stops before the provider for %s', async (reason, message) => {
    const getLlm = vi.fn()
    const prepared: ClaimCheckEvidenceResult = {
      ok: true,
      status: 'insufficient_evidence',
      reason,
      request: ready.request,
    }
    const outcome = await assessClaimSupport({}, {
      db,
      prepareEvidence: async () => prepared,
      getLlm,
    })
    expect(outcome).toMatchObject({
      ok: true,
      status: 'insufficient_evidence',
      stage: 'evidence',
      reason,
    })
    expect(JSON.stringify(outcome)).toContain(message)
    expect(getLlm).not.toHaveBeenCalled()
  })

  it.each([
    [new LlmError('rate_limited', 'secret'), 'checker_busy'],
    [new LlmError('timeout', 'secret'), 'checker_timeout'],
    [new LlmError('provider_error', 'secret'), 'checker_unavailable'],
    [new Error('raw response and secret'), 'checker_unavailable'],
    [
      new LlmError('invalid_response', 'secret', undefined, {
        category: 'truncated', model: null, finishReason: 'length',
      }),
      'checker_truncated',
    ],
  ] as const)('maps provider failure to %s without retry', async (error, expected) => {
    const fake = provider(async () => {
      throw error
    })
    const outcome = await assessClaimSupport({}, {
      db,
      prepareEvidence: async () => ready,
      getLlm: () => fake.llm,
    })
    expect(outcome).toEqual({ ok: false, error: expected })
    expect(fake.generateStructured).toHaveBeenCalledOnce()
    expect(JSON.stringify(outcome)).not.toContain('secret')
  })

  it('rejects length, malformed output, and invalid assessment without partial results', async () => {
    for (const [structured, expected] of [
      [result(generated, 'length'), 'checker_truncated'],
      [result({ malformed: true }), 'invalid_output'],
      [
        result({
          ...generated,
          unsupported_fragments: ['not present in claim'],
          overall_support: 'partially_supported',
        }),
        'invalid_assessment',
      ],
    ] as const) {
      const fake = provider(async () => structured)
      const outcome = await assessClaimSupport({}, {
        db,
        prepareEvidence: async () => ready,
        getLlm: () => fake.llm,
      })
      expect(outcome).toEqual({ ok: false, error: expected })
      expect(outcome).not.toHaveProperty('assessment')
    }
  })

  it('does not call the provider for evidence errors or preparation exceptions', async () => {
    for (const prepareEvidence of [
      async (): Promise<ClaimCheckEvidenceResult> => ({ ok: false, error: 'scope_not_found' }),
      async (): Promise<ClaimCheckEvidenceResult> => {
        throw new Error('private database detail')
      },
    ]) {
      const getLlm = vi.fn()
      const outcome = await assessClaimSupport({}, { db, prepareEvidence, getLlm })
      expect(outcome.ok).toBe(false)
      expect(getLlm).not.toHaveBeenCalled()
    }
  })
})
