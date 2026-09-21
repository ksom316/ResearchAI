import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '#/lib/llm'
import {
  logResearchChatDiagnostic,
  researchChatProviderFailureDiagnostic,
  researchChatResultFailureDiagnostic,
} from './diagnostics'

const context = {
  errorCode: 'answer_unavailable' as const,
  retrievalResultCount: 8,
  evidenceItemCount: 6,
  elapsedMs: 321,
}

describe('Research Chat safe diagnostics', () => {
  it('logs only the fixed content-free diagnostic with the Research Chat prefix', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const secret = 'secret prompt, evidence, response, and API key'
    const diagnostic = researchChatProviderFailureDiagnostic(
      context,
      new LlmError('provider_error', secret, 503, {
        category: 'truncated',
        model: 'vendor/safe-model',
        finishReason: 'length',
        usage: {
          promptTokens: 100,
          completionTokens: 200,
          totalTokens: 300,
          reasoningTokens: 50,
        },
      }),
    )

    logResearchChatDiagnostic(diagnostic)

    expect(warn).toHaveBeenCalledWith('[research-chat]', diagnostic)
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret)
    expect(diagnostic).toMatchObject({
      stage: 'provider',
      llmKind: 'provider_error',
      responseCategory: 'truncated',
      httpStatus: 503,
      model: 'vendor/safe-model',
      finishReason: 'length',
      structuredContentReturned: false,
      retrievalResultCount: 8,
      evidenceItemCount: 6,
      elapsedMs: 321,
    })
    warn.mockRestore()
  })

  it('reports structured and citation validation metadata without response data', () => {
    const result = {
      data: { unsafe: 'raw model output must not be logged' },
      provider: 'openrouter',
      model: 'vendor/model',
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    }

    for (const stage of ['structured_output', 'citation_validation'] as const) {
      const diagnostic = researchChatResultFailureDiagnostic(
        stage,
        context,
        result,
      )
      expect(diagnostic.stage).toBe(stage)
      expect(JSON.stringify(diagnostic)).not.toContain('raw model output')
      expect(diagnostic).not.toHaveProperty('data')
      expect(diagnostic.usage).toEqual({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        reasoningTokens: null,
      })
    }
  })

  it('drops unsafe provider identifiers and invalid numeric metadata', () => {
    const diagnostic = researchChatProviderFailureDiagnostic(
      { ...context, retrievalResultCount: -1, elapsedMs: Number.NaN },
      new LlmError('invalid_response', 'safe fixed error', 999, {
        category: 'not_json',
        model: 'model with evidence text',
        finishReason: 'stop\nsecret',
      }),
    )
    expect(diagnostic).toMatchObject({
      httpStatus: null,
      model: null,
      finishReason: null,
      retrievalResultCount: null,
      elapsedMs: 0,
    })
  })
})
