import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '#/lib/llm'
import type {
  LlmProvider,
  StructuredRequest,
  StructuredResult,
} from '#/lib/llm'
import { createMeteredLlm } from './metered-llm'
import type {
  UsageAllowanceExceededError,
  UsageAllowanceStatus,
  UsageEventInput,
} from './types'

const request: StructuredRequest = {
  system: 'system',
  user: 'user',
  schema: { name: 'answer', schema: { type: 'object' } },
  maxTokens: 100,
}

const result = (usage: StructuredResult['usage']): StructuredResult => ({
  data: { ok: true },
  usage,
  provider: 'openrouter',
  model: 'openrouter/actual-model',
  finishReason: 'stop',
})

const allowance = (
  overrides: Partial<UsageAllowanceStatus> = {},
): UsageAllowanceStatus => ({
  periodStart: '2026-09-01T00:00:00.000Z',
  periodEnd: '2026-10-01T00:00:00.000Z',
  requestsUsed: 1,
  requestLimit: 100,
  requestsRemaining: 99,
  tokensUsed: 10,
  tokenLimit: 250000,
  tokensRemaining: 249990,
  requestPercent: 1,
  tokenPercent: 0,
  percentageUsed: 1,
  allowed: true,
  exhaustedReason: null,
  ...overrides,
})

function provider(
  implementation: () => Promise<StructuredResult>,
): LlmProvider {
  return {
    providerName: 'openrouter',
    modelName: 'openrouter/configured-model',
    generateStructured: implementation,
  }
}

describe('createMeteredLlm', () => {
  it('checks the authenticated actor before calling the provider', async () => {
    const generateStructured = vi.fn(async () => result(null))
    const checkAllowance = vi.fn(async () => allowance())
    const llm = createMeteredLlm(provider(generateStructured), {
      actorUserId: 'collaborator-a',
      projectId: 'project-owner-b',
      feature: 'research_chat',
      recordUsage: vi.fn(),
      checkAllowance,
    })

    await llm.generateStructured(request)

    expect(checkAllowance).toHaveBeenCalledWith('collaborator-a')
    expect(generateStructured).toHaveBeenCalledOnce()
  })

  it.each(['requests', 'tokens'] as const)(
    'blocks the provider when the %s allowance is exhausted',
    async (exhaustedReason) => {
      const generateStructured = vi.fn(async () => result(null))
      const recordUsage = vi.fn()
      const llm = createMeteredLlm(provider(generateStructured), {
        actorUserId: 'ama',
        projectId: null,
        feature: 'research_chat',
        recordUsage,
        checkAllowance: async () =>
          allowance({ allowed: false, exhaustedReason }),
      })

      await expect(llm.generateStructured(request)).rejects.toEqual(
        expect.objectContaining({
          name: 'UsageAllowanceExceededError',
          resetDate: '2026-10-01T00:00:00.000Z',
        }) satisfies Partial<UsageAllowanceExceededError>,
      )
      expect(generateStructured).not.toHaveBeenCalled()
      expect(recordUsage).not.toHaveBeenCalled()
    },
  )

  it('fails closed before the provider when no authenticated actor exists', async () => {
    const generateStructured = vi.fn(async () => result(null))
    const llm = createMeteredLlm(provider(generateStructured), {
      actorUserId: null,
      projectId: null,
      feature: 'research_chat',
      recordUsage: vi.fn(),
      checkAllowance: vi.fn(),
    })

    await expect(llm.generateStructured(request)).rejects.toMatchObject({
      kind: 'auth',
    })
    expect(generateStructured).not.toHaveBeenCalled()
  })

  it.each([
    'research_chat',
    'academic_writer',
    'claim_checker',
    'evidence_matrix',
    'research_gaps',
  ] as const)(
    'records the verified actor, project and %s feature',
    async (feature) => {
      const events: UsageEventInput[] = []
      const llm = createMeteredLlm(
        provider(async () =>
          result({
            inputTokens: 120,
            outputTokens: 30,
            totalTokens: 150,
          }),
        ),
        {
          actorUserId: 'ama',
          projectId: 'project-a',
          feature,
          operationKey: 'op-1',
          recordUsage: async (event) => {
            events.push(event)
          },
        },
      )

      await llm.generateStructured(request)

      expect(events).toEqual([
        expect.objectContaining({
          actorUserId: 'ama',
          projectId: 'project-a',
          feature,
          eventType: 'llm_request',
          provider: 'openrouter',
          model: 'openrouter/actual-model',
          inputTokens: 120,
          outputTokens: 30,
          totalTokens: 150,
          quantity: 1,
          idempotencyKey: 'op-1:0',
        }),
      ])
    },
  )

  it('keeps unavailable provider token metadata null instead of estimating', async () => {
    const recordUsage = vi.fn(async (_event: UsageEventInput) => undefined)
    const llm = createMeteredLlm(
      provider(async () => result(null)),
      {
        actorUserId: 'ama',
        projectId: null,
        feature: 'research_chat',
        recordUsage,
      },
    )

    await llm.generateStructured(request)

    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      }),
    )
  })

  it('records failure attempts and preserves provider diagnostic usage', async () => {
    const recordUsage = vi.fn(async (_event: UsageEventInput) => undefined)
    const error = new LlmError('invalid_response', 'invalid', undefined, {
      category: 'truncated',
      model: 'openrouter/served-model',
      finishReason: 'length',
      usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
    })
    const llm = createMeteredLlm(
      provider(async () => Promise.reject(error)),
      {
        actorUserId: 'ama',
        projectId: 'project-a',
        feature: 'claim_checker',
        recordUsage,
      },
    )

    await expect(llm.generateStructured(request)).rejects.toBe(error)
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openrouter/served-model',
        inputTokens: 8,
        outputTokens: 4,
        totalTokens: 12,
        metadata: { outcome: 'failure' },
      }),
    )
  })

  it('does not break the LLM when the metering write fails', async () => {
    const llm = createMeteredLlm(
      provider(async () => result(null)),
      {
        actorUserId: 'ama',
        projectId: null,
        feature: 'academic_writer',
        recordUsage: async () => {
          throw new Error('database unavailable')
        },
      },
    )

    await expect(llm.generateStructured(request)).resolves.toMatchObject({
      data: { ok: true },
    })
  })
})
