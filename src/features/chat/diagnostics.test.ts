import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '#/lib/llm'
import {
  logResearchChatDiagnostic,
  researchChatProviderFailureDiagnostic,
  researchChatResultFailureDiagnostic,
  researchChatSchemaFailureDiagnostic,
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

  it('reports schema shape and issue paths without generated content', () => {
    const secretAnswer = 'generated answer text that must remain private'
    const result = {
      data: {
        status: 'answered',
        segments: [{ text: secretAnswer, citations: 'wrong type' }],
        explanation: null,
        limitations: null,
      },
      provider: 'openrouter',
      model: 'vendor/model',
      finishReason: 'stop',
      usage: null,
    }
    const diagnostic = researchChatSchemaFailureDiagnostic(
      context,
      result,
      [
        {
          code: 'invalid_type',
          path: ['segments', 0, 'citations'],
          expected: 'array',
        },
        {
          code: 'invalid_type',
          path: ['followUps'],
          expected: 'array',
        },
      ],
    )

    expect(diagnostic.schemaValidation).toEqual({
      category: 'schema_validation',
      topLevelType: 'object',
      expectedKeysPresent: {
        status: true,
        segments: true,
        explanation: true,
        limitations: true,
        followUps: false,
      },
      segmentsCount: 1,
      followUpsCount: null,
      issues: [
        {
          code: 'invalid_type',
          path: ['segments', 0, 'citations'],
          expected: 'array',
          actualType: 'string',
        },
        {
          code: 'invalid_type',
          path: ['followUps'],
          expected: 'array',
          actualType: 'undefined',
        },
      ],
    })
    expect(diagnostic.schemaIssueSummary).toBe(
      'invalid_type|path=segments[0].citations|expected=array|actual=string; invalid_type|path=followUps|expected=array|actual=undefined',
    )
    expect(JSON.stringify(diagnostic)).not.toContain(secretAnswer)
    expect(JSON.stringify(diagnostic)).not.toContain('wrong type')
  })

  it('redacts model-controlled schema paths and expected values', () => {
    const diagnostic = researchChatSchemaFailureDiagnostic(
      context,
      {
        data: { segments: [] },
        provider: 'openrouter',
        model: 'vendor/model',
        usage: null,
      },
      [
        {
          code: 'custom',
          path: ['secret generated field'],
          expected: 'answer text with spaces',
        },
      ],
    )
    expect(diagnostic.schemaValidation?.issues).toEqual([
      {
        code: 'custom',
        path: ['<other>'],
        expected: null,
        actualType: 'undefined',
      },
    ])
    expect(diagnostic.schemaIssueSummary).toBe(
      'custom|path=<other>|expected=n/a|actual=undefined',
    )
  })

  it('bounds the flat issue summary and never copies issue messages or values', () => {
    const secret = 'MODEL_GENERATED_SECRET_TEXT'
    const diagnostic = researchChatSchemaFailureDiagnostic(
      context,
      {
        data: { status: secret, segments: [] },
        provider: 'openrouter',
        model: 'vendor/model',
        usage: null,
      },
      Array.from({ length: 40 }, () => ({
        code: 'invalid_value',
        path: [secret, secret, secret],
        expected: secret,
        message: secret,
      })),
    )

    expect(diagnostic.schemaIssueSummary?.length).toBeLessThanOrEqual(2_000)
    expect(diagnostic.schemaIssueSummary).toContain(
      'invalid_value|path=<other>.<other>.<other>|expected=n/a|actual=undefined',
    )
    expect(JSON.stringify(diagnostic)).not.toContain(secret)
  })
})
