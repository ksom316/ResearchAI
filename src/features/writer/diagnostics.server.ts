import { LlmError } from '#/lib/llm'
import type {
  LlmDiagnosticUsage,
  LlmErrorKind,
  LlmFailureCategory,
  StructuredResult,
} from '#/lib/llm'
import type {
  WriterGenerationErrorCode,
  WriterMode,
} from './types'

type WriterDiagnosticUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
}

export type WriterGenerationDiagnostic = {
  event: 'writer_generation_failure'
  mode: WriterMode
  layer: 'provider' | 'structured_response' | 'validation'
  errorCode: WriterGenerationErrorCode
  llmKind: LlmErrorKind | 'unexpected' | null
  responseCategory: LlmFailureCategory | null
  httpStatus: number | null
  provider: string | null
  model: string | null
  finishReason: string | null
  structuredContentReturned: boolean
  usage: WriterDiagnosticUsage | null
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:/@-]{1,100}$/

function safeIdentifier(value: unknown): string | null {
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value) ? value : null
}

function safeCount(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null
}

function diagnosticUsage(
  usage: LlmDiagnosticUsage | undefined,
): WriterDiagnosticUsage | null {
  if (!usage) return null
  return {
    promptTokens: safeCount(usage.promptTokens),
    completionTokens: safeCount(usage.completionTokens),
    totalTokens: safeCount(usage.totalTokens),
    reasoningTokens: safeCount(usage.reasoningTokens),
  }
}

function resultUsage(result: StructuredResult): WriterDiagnosticUsage | null {
  if (!result.usage) return null
  return {
    promptTokens: safeCount(result.usage.inputTokens),
    completionTokens: safeCount(result.usage.outputTokens),
    totalTokens: safeCount(result.usage.totalTokens),
    reasoningTokens: null,
  }
}

export function writerProviderFailureDiagnostic(
  mode: WriterMode,
  errorCode: WriterGenerationErrorCode,
  error: unknown,
): WriterGenerationDiagnostic {
  const llmError = error instanceof LlmError ? error : null
  return {
    event: 'writer_generation_failure',
    mode,
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
    usage: diagnosticUsage(llmError?.diagnostic?.usage),
  }
}

export function writerResultFailureDiagnostic(
  mode: WriterMode,
  layer: 'structured_response' | 'validation',
  errorCode: WriterGenerationErrorCode,
  result: StructuredResult,
): WriterGenerationDiagnostic {
  return {
    event: 'writer_generation_failure',
    mode,
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

/** Development-only, content-free diagnostic output. */
export function logWriterGenerationDiagnostic(
  diagnostic: WriterGenerationDiagnostic,
  developmentEnabled = false,
): void {
  if (!developmentEnabled) return
  console.warn('[writer:diagnostic]', diagnostic)
}
