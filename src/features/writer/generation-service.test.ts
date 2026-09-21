import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '#/lib/llm'
import type {
  LlmProvider,
  StructuredRequest,
  StructuredResult,
} from '#/lib/llm'
import {
  generateWriterDraft,
  MAX_WRITER_OUTPUT_TOKENS,
  WRITER_ABSTENTION_EXPLANATIONS,
} from './generation-service'
import { WRITER_DRAFT_JSON_SCHEMA } from './generation-schema'
import type {
  WriterEvidenceItem,
  WriterEvidenceResult,
  WriterGenerationResult,
} from './types'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222222'
const P2 = '33333333-3333-4333-8333-333333333333'

const item = (number: number, paperId: string): WriterEvidenceItem => ({
  id: `W${number}`,
  locator: {
    kind: 'extraction_claim',
    paperId,
    schemaVersion: 1,
    fieldKey: 'findings',
    itemIndex: 0,
  },
  paperId,
  paperTitle: number === 1 ? 'Alpha' : 'Beta',
  claimText: `Finding ${number}`,
  sourceRecords: [
    {
      chunkId: null,
      sectionId: null,
      sectionTitle: 'Results',
      sectionType: 'results',
      pageStart: number,
      pageEnd: number,
      excerpt: `Support ${number}`,
      content: null,
    },
  ],
  promptText: `Claim: Finding ${number}\nSource 1: Support ${number}`,
  isStale: false,
})

const ready: WriterEvidenceResult = {
  ok: true,
  status: 'ready',
  request: { projectId: PROJECT, mode: 'findings_synthesis' },
  evidence: {
    items: [item(1, P1), item(2, P2)],
    paperIds: [P1, P2],
    totalPromptChars: 80,
  },
  coverage: {
    projectPaperCount: 2,
    selectedPaperCount: 2,
    participatingPaperCount: 2,
    unavailablePaperCount: 0,
    evidenceItemCount: 2,
  },
}

const structuredResult = (
  data: Record<string, unknown>,
  finishReason: string | null = 'stop',
): StructuredResult => ({
  data,
  usage: null,
  provider: 'test',
  model: 'test/model',
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

const generated = {
  status: 'generated',
  paragraphs: [
    {
      units: [
        {
          text: 'The studies report related findings.',
          citation_ids: ['W1', 'W2'],
        },
      ],
    },
  ],
}

describe('Writer generation service', () => {
  it.each([
    ['no_evidence', 0],
    ['insufficient_evidence', 1],
    ['stale_only', 1],
  ] as const)('stops before the provider for %s', async (status, count) => {
    const getLlm = vi.fn()
    const prepared: WriterEvidenceResult = {
      ok: true,
      status,
      request: { projectId: PROJECT, mode: 'findings_synthesis' },
      coverage: {
        projectPaperCount: 2,
        selectedPaperCount: 2,
        participatingPaperCount: count,
        unavailablePaperCount: 2 - count,
        evidenceItemCount: count,
      },
    }
    const result = await generateWriterDraft(
      { projectId: PROJECT, mode: 'findings_synthesis' },
      { prepareEvidence: async () => prepared, getLlm },
    )
    expect(result).toMatchObject({
      ok: true,
      status,
      stage: 'evidence',
      explanation: WRITER_ABSTENTION_EXPLANATIONS[status],
    })
    expect(getLlm).not.toHaveBeenCalled()
  })

  it('makes exactly one bounded, no-reasoning structured call for ready evidence', async () => {
    const fake = provider(async () => structuredResult(generated))
    const getLlm = vi.fn(() => fake.llm)
    const result = await generateWriterDraft(
      { projectId: PROJECT, mode: 'findings_synthesis' },
      {
        prepareEvidence: async () => ready,
        getLlm,
        nonce: () => 'fixed-nonce',
      },
    )
    expect(result.ok && result.status).toBe('generated')
    expect(getLlm).toHaveBeenCalledTimes(1)
    expect(fake.generateStructured).toHaveBeenCalledTimes(1)
    const call = fake.generateStructured.mock.calls[0][0]
    expect(call.maxTokens).toBe(MAX_WRITER_OUTPUT_TOKENS)
    expect(call.maxTokens).toBe(1_800)
    expect(call.reasoning).toEqual({ effort: 'none' })
    expect(call.schema).toBe(WRITER_DRAFT_JSON_SCHEMA)
    expect(call.user).toContain('AUTHORIZED EVIDENCE IDS: W1, W2')
    expect(call.system).toContain('ONLY the supplied Writer evidence')
  })

  it('accepts provider abstention only with a fixed server-owned explanation', async () => {
    const fake = provider(async () =>
      structuredResult({ status: 'insufficient_evidence', paragraphs: [] }),
    )
    const result = await generateWriterDraft(
      {},
      {
        prepareEvidence: async () => ready,
        getLlm: () => fake.llm,
      },
    )
    expect(result).toEqual({
      ok: true,
      status: 'insufficient_evidence',
      stage: 'generation',
      explanation: WRITER_ABSTENTION_EXPLANATIONS.insufficient_evidence,
      request: ready.request,
      coverage: ready.coverage,
    })
  })

  it.each([
    [
      'malformed output',
      { status: 'generated', paragraphs: 'not-an-array' },
      'invalid_output',
    ],
    [
      'unknown citation',
      {
        status: 'generated',
        paragraphs: [{ units: [{ text: 'Claim.', citation_ids: ['W99'] }] }],
      },
      'invalid_citation',
    ],
    [
      'invalid generated content',
      {
        status: 'generated',
        paragraphs: [
          { units: [{ text: 'Claim [W1].', citation_ids: ['W1'] }] },
        ],
      },
      'invalid_content',
    ],
  ] as const)(
    'rejects %s without a partial draft',
    async (_name, data, error) => {
      const fake = provider(async () => structuredResult(data))
      const result = await generateWriterDraft(
        {},
        {
          prepareEvidence: async () => ready,
          getLlm: () => fake.llm,
        },
      )
      expect(result).toEqual({ ok: false, error })
      expect(result).not.toHaveProperty('draft')
    },
  )

  it('rejects a provider-reported length finish without validating partial data', async () => {
    const fake = provider(async () => structuredResult(generated, 'length'))
    await expect(
      generateWriterDraft(
        {},
        {
          prepareEvidence: async () => ready,
          getLlm: () => fake.llm,
        },
      ),
    ).resolves.toEqual({ ok: false, error: 'writer_truncated' })
  })

  it.each([
    [new LlmError('rate_limited', 'safe'), 'writer_busy'],
    [new LlmError('timeout', 'safe'), 'writer_timeout'],
    [new LlmError('provider_error', 'safe'), 'writer_unavailable'],
    [new LlmError('auth', 'safe'), 'writer_unavailable'],
    [new Error('raw provider body with secret'), 'writer_unavailable'],
  ] as const)(
    'maps provider failure safely to %s',
    async (thrown, expected) => {
      const fake = provider(async () => {
        throw thrown
      })
      const result = await generateWriterDraft(
        {},
        {
          prepareEvidence: async () => ready,
          getLlm: () => fake.llm,
        },
      )
      expect(result).toEqual({ ok: false, error: expected })
      expect(JSON.stringify(result)).not.toContain('secret')
    },
  )

  it('maps provider truncation diagnostics separately from malformed output', async () => {
    const truncated = new LlmError('invalid_response', 'safe', undefined, {
      category: 'truncated',
      model: null,
      finishReason: 'length',
    })
    const malformed = new LlmError('invalid_response', 'safe', undefined, {
      category: 'not_json',
      model: null,
      finishReason: 'stop',
    })
    for (const [error, expected] of [
      [truncated, 'writer_truncated'],
      [malformed, 'invalid_output'],
    ] as const) {
      const fake = provider(async () => {
        throw error
      })
      await expect(
        generateWriterDraft(
          {},
          {
            prepareEvidence: async () => ready,
            getLlm: () => fake.llm,
          },
        ),
      ).resolves.toEqual({ ok: false, error: expected })
    }
  })

  it('reports safe provider diagnostics without changing the returned error', async () => {
    const logDiagnostic = vi.fn()
    const fake = provider(async () => {
      throw new LlmError(
        'provider_error',
        'raw provider response containing secret evidence',
        503,
        {
          category: 'empty',
          model: 'openrouter/free',
          finishReason: null,
          usage: { promptTokens: 321, completionTokens: 0 },
        },
      )
    })

    const result = await generateWriterDraft(
      {},
      {
        prepareEvidence: async () => ready,
        getLlm: () => fake.llm,
        logDiagnostic,
      },
    )

    expect(result).toEqual({ ok: false, error: 'writer_unavailable' })
    expect(logDiagnostic).toHaveBeenCalledOnce()
    expect(logDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'findings_synthesis',
        layer: 'provider',
        errorCode: 'writer_unavailable',
        llmKind: 'provider_error',
        httpStatus: 503,
        model: 'openrouter/free',
        structuredContentReturned: false,
      }),
    )
    expect(JSON.stringify(logDiagnostic.mock.calls)).not.toMatch(
      /secret evidence|raw provider response/i,
    )
  })

  it('passes browser input only to authenticated evidence preparation', async () => {
    const raw = {
      projectId: PROJECT,
      mode: 'findings_synthesis',
      evidence: ready.evidence,
      userId: 'forged',
      model: 'paid/model',
    }
    const prepareEvidence = vi.fn(async (): Promise<WriterEvidenceResult> => ({
      ok: false,
      error: 'invalid_request',
    }))
    const getLlm = vi.fn()
    const result: WriterGenerationResult = await generateWriterDraft(raw, {
      prepareEvidence,
      getLlm,
    })
    expect(prepareEvidence).toHaveBeenCalledWith(raw)
    expect(getLlm).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: 'invalid_request' })
  })

  it('maps unexpected evidence-preparation failures without exposing details', async () => {
    const getLlm = vi.fn()
    const result = await generateWriterDraft(
      {},
      {
        prepareEvidence: async () => {
          throw new Error('private database detail')
        },
        getLlm,
      },
    )
    expect(result).toEqual({ ok: false, error: 'retrieval_unavailable' })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(getLlm).not.toHaveBeenCalled()
  })
})
