import { LlmError } from '#/lib/llm'
import type {
  LlmDiagnosticUsage,
  LlmErrorKind,
  LlmFailureCategory,
  StructuredResult,
} from '#/lib/llm'
import type { ClaimCheckAssessmentError } from './types'

type SafeUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
}

export type ClaimCheckDiagnostic = {
  event: 'claim_check_failure'
  layer: 'provider' | 'structured_response' | 'validation'
  errorCode: ClaimCheckAssessmentError
  llmKind: LlmErrorKind | 'unexpected' | null
  responseCategory: LlmFailureCategory | null
  httpStatus: number | null
  provider: string | null
  model: string | null
  finishReason: string | null
  structuredContentReturned: boolean
  usage: SafeUsage | null
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:/@-]{1,100}$/
const safeIdentifier = (value: unknown) =>
  typeof value === 'string' && SAFE_IDENTIFIER.test(value) ? value : null
const safeCount = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null

function errorUsage(usage?: LlmDiagnosticUsage): SafeUsage | null {
  if (!usage) return null
  return {
    promptTokens: safeCount(usage.promptTokens),
    completionTokens: safeCount(usage.completionTokens),
    totalTokens: safeCount(usage.totalTokens),
    reasoningTokens: safeCount(usage.reasoningTokens),
  }
}

function resultUsage(result: StructuredResult): SafeUsage | null {
  if (!result.usage) return null
  return {
    promptTokens: safeCount(result.usage.inputTokens),
    completionTokens: safeCount(result.usage.outputTokens),
    totalTokens: safeCount(result.usage.totalTokens),
    reasoningTokens: null,
  }
}

export function claimCheckProviderDiagnostic(
  errorCode: ClaimCheckAssessmentError,
  error: unknown,
): ClaimCheckDiagnostic {
  const llmError = error instanceof LlmError ? error : null
  return {
    event: 'claim_check_failure',
    layer: 'provider',
    errorCode,
    llmKind: llmError?.kind ?? 'unexpected',
    responseCategory: llmError?.diagnostic?.category ?? null,
    httpStatus:
      llmError?.status &&
      Number.isSafeInteger(llmError.status) &&
      llmError.status >= 100 &&
      llmError.status <= 599
        ? llmError.status
        : null,
    provider: null,
    model: safeIdentifier(llmError?.diagnostic?.model),
    finishReason: safeIdentifier(llmError?.diagnostic?.finishReason),
    structuredContentReturned: false,
    usage: errorUsage(llmError?.diagnostic?.usage),
  }
}

export function claimCheckResultDiagnostic(
  layer: 'structured_response' | 'validation',
  errorCode: ClaimCheckAssessmentError,
  result: StructuredResult,
): ClaimCheckDiagnostic {
  return {
    event: 'claim_check_failure',
    layer,
    errorCode,
    llmKind: null,
    responseCategory: null,
    httpStatus: null,
    provider: safeIdentifier(result.provider),
    model: safeIdentifier(result.model),
    finishReason: safeIdentifier(result.finishReason),
    structuredContentReturned: true,
    usage: resultUsage(result),
  }
}

export function logClaimCheckDiagnostic(
  diagnostic: ClaimCheckDiagnostic,
  developmentEnabled = false,
): void {
  if (!developmentEnabled) return
  console.warn('[claim-checker:diagnostic]', diagnostic)
}
