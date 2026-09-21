import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '#/lib/llm'
import type { StructuredResult } from '#/lib/llm'
import {
  logWriterGenerationDiagnostic,
  writerProviderFailureDiagnostic,
  writerResultFailureDiagnostic,
} from './diagnostics.server'

describe('Writer generation diagnostics', () => {
  it('keeps only safe provider metadata and excludes error content', () => {
    const error = new LlmError(
      'provider_error',
      'Authorization: Bearer secret-key; prompt and evidence contents',
      503,
      {
        category: 'empty',
        model: 'safe-provider/model-free',
        finishReason: 'stop',
        usage: {
          promptTokens: 1200,
          completionTokens: 17,
          totalTokens: 1217,
          reasoningTokens: 12,
        },
      },
    )

    const diagnostic = writerProviderFailureDiagnostic(
      'limitations_future_work',
      'writer_unavailable',
      error,
    )

    expect(diagnostic).toEqual({
      event: 'writer_generation_failure',
      mode: 'limitations_future_work',
      layer: 'provider',
      errorCode: 'writer_unavailable',
      llmKind: 'provider_error',
      responseCategory: 'empty',
      httpStatus: 503,
      provider: null,
      model: 'safe-provider/model-free',
      finishReason: 'stop',
      structuredContentReturned: false,
      usage: {
        promptTokens: 1200,
        completionTokens: 17,
        totalTokens: 1217,
        reasoningTokens: 12,
      },
    })
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /secret-key|prompt and evidence|Authorization/i,
    )
  })

  it('does not copy unexpected errors or unsafe provider identifiers', () => {
    const unexpected = writerProviderFailureDiagnostic(
      'limitations_future_work',
      'writer_unavailable',
      new Error('cookie=secret; complete paper contents'),
    )
    const result: StructuredResult = {
      data: { raw: 'private model output and evidence' },
      usage: null,
      provider: 'openrouter\nprivate prompt',
      model: 'model with secret evidence',
      finishReason: 'stop\nraw-output',
    }
    const invalid = writerResultFailureDiagnostic(
      'limitations_future_work',
      'validation',
      'invalid_output',
      result,
    )

    expect(unexpected.llmKind).toBe('unexpected')
    expect(invalid).toMatchObject({
      provider: null,
      model: null,
      finishReason: null,
      structuredContentReturned: true,
    })
    expect(JSON.stringify([unexpected, invalid])).not.toMatch(
      /cookie=secret|paper contents|private model output|private prompt|secret evidence|raw-output/i,
    )
  })

  it('logs only in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const diagnostic = writerProviderFailureDiagnostic(
      'limitations_future_work',
      'writer_unavailable',
      new LlmError('auth', 'secret authorization detail', 401),
    )

    logWriterGenerationDiagnostic(diagnostic)
    logWriterGenerationDiagnostic(diagnostic, false)
    expect(warn).not.toHaveBeenCalled()

    logWriterGenerationDiagnostic(diagnostic, true)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith('[writer:diagnostic]', diagnostic)
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      'secret authorization detail',
    )
    warn.mockRestore()
  })
})
