import { LlmError } from '#/lib/llm'
import type {
  LlmDiagnosticUsage,
  LlmErrorKind,
  LlmFailureCategory,
  StructuredResult,
} from '#/lib/llm'
import type { ChatErrorCode } from './types'

type ResearchChatDiagnosticUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
}

export type ResearchChatDiagnostic = {
  event: 'research_chat_failure'
  stage:
    | 'request_validation'
    | 'retrieval'
    | 'provider'
    | 'structured_output'
    | 'citation_validation'
    | 'unexpected'
  errorCode: ChatErrorCode
  llmKind: LlmErrorKind | 'unexpected' | null
  responseCategory: LlmFailureCategory | null
  httpStatus: number | null
  provider: string | null
  model: string | null
  finishReason: string | null
  structuredContentReturned: boolean | null
  retrievalResultCount: number | null
  evidenceItemCount: number | null
  elapsedMs: number
  usage: ResearchChatDiagnosticUsage | null
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:/@-]{1,100}$/

const safeIdentifier = (value: unknown): string | null =>
  typeof value === 'string' && SAFE_IDENTIFIER.test(value) ? value : null

const safeCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null

const diagnosticUsage = (
  usage: LlmDiagnosticUsage | undefined,
): ResearchChatDiagnosticUsage | null =>
  usage
    ? {
        promptTokens: safeCount(usage.promptTokens),
        completionTokens: safeCount(usage.completionTokens),
        totalTokens: safeCount(usage.totalTokens),
        reasoningTokens: safeCount(usage.reasoningTokens),
      }
    : null

const resultUsage = (
  result: StructuredResult,
): ResearchChatDiagnosticUsage | null =>
  result.usage
    ? {
        promptTokens: safeCount(result.usage.inputTokens),
        completionTokens: safeCount(result.usage.outputTokens),
        totalTokens: safeCount(result.usage.totalTokens),
        reasoningTokens: null,
      }
    : null

type Context = {
  errorCode: ChatErrorCode
  retrievalResultCount?: number
  evidenceItemCount?: number
  elapsedMs: number
}

const base = (context: Context): ResearchChatDiagnostic => ({
  event: 'research_chat_failure',
  stage: 'unexpected',
  errorCode: context.errorCode,
  llmKind: null,
  responseCategory: null,
  httpStatus: null,
  provider: null,
  model: null,
  finishReason: null,
  structuredContentReturned: null,
  retrievalResultCount: safeCount(context.retrievalResultCount),
  evidenceItemCount: safeCount(context.evidenceItemCount),
  elapsedMs: safeCount(context.elapsedMs) ?? 0,
  usage: null,
})

export function researchChatFailureDiagnostic(
  stage: ResearchChatDiagnostic['stage'],
  context: Context,
): ResearchChatDiagnostic {
  return { ...base(context), stage }
}

export function researchChatProviderFailureDiagnostic(
  context: Context,
  error: unknown,
): ResearchChatDiagnostic {
  const llmError = error instanceof LlmError ? error : null
  return {
    ...base(context),
    stage: 'provider',
    llmKind: llmError?.kind ?? 'unexpected',
    responseCategory: llmError?.diagnostic?.category ?? null,
    httpStatus:
      llmError?.status &&
      Number.isSafeInteger(llmError.status) &&
      llmError.status >= 100 &&
      llmError.status <= 599
        ? llmError.status
        : null,
    model: safeIdentifier(llmError?.diagnostic?.model),
    finishReason: safeIdentifier(llmError?.diagnostic?.finishReason),
    structuredContentReturned: false,
    usage: diagnosticUsage(llmError?.diagnostic?.usage),
  }
}

export function researchChatResultFailureDiagnostic(
  stage: 'structured_output' | 'citation_validation',
  context: Context,
  result: StructuredResult,
): ResearchChatDiagnostic {
  return {
    ...base(context),
    stage,
    provider: safeIdentifier(result.provider),
    model: safeIdentifier(result.model),
    finishReason: safeIdentifier(result.finishReason),
    structuredContentReturned: true,
    usage: resultUsage(result),
  }
}

/** Production-safe and content-free. Callers can only supply the fixed shape above. */
export function logResearchChatDiagnostic(
  diagnostic: ResearchChatDiagnostic,
): void {
  console.warn('[research-chat]', diagnostic)
}
