import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '#/lib/llm'
import {
  claimCheckProviderDiagnostic,
  logClaimCheckDiagnostic,
} from './diagnostics.server'

describe('Claim Checker safe diagnostics', () => {
  it('contains only safe provider metadata and never error content', () => {
    const diagnostic = claimCheckProviderDiagnostic(
      'checker_unavailable',
      new LlmError(
        'provider_error',
        'Authorization Bearer secret plus claim and evidence',
        503,
        {
          category: 'empty',
          model: 'vendor/free:free',
          finishReason: 'stop',
          usage: { promptTokens: 400, completionTokens: 0, totalTokens: 400 },
        },
      ),
    )
    expect(diagnostic).toMatchObject({
      layer: 'provider',
      errorCode: 'checker_unavailable',
      llmKind: 'provider_error',
      httpStatus: 503,
      model: 'vendor/free:free',
      structuredContentReturned: false,
    })
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /Authorization|secret|claim and evidence/i,
    )
  })

  it('is silent unless explicitly enabled for development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const diagnostic = claimCheckProviderDiagnostic(
      'checker_unavailable',
      new Error('private content'),
    )
    logClaimCheckDiagnostic(diagnostic)
    logClaimCheckDiagnostic(diagnostic, false)
    expect(warn).not.toHaveBeenCalled()
    logClaimCheckDiagnostic(diagnostic, true)
    expect(warn).toHaveBeenCalledWith('[claim-checker:diagnostic]', diagnostic)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private content')
    warn.mockRestore()
  })
})
