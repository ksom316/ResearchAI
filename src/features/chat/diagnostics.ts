import { LlmError } from '#/lib/llm'
import type {
  LlmDiagnosticUsage,
  LlmErrorKind,
  LlmFailureCategory,
  StructuredResult,
} from '#/lib/llm'
import {
  UsageAllowanceCheckError,
  UsageAllowanceExceededError,
} from '#/lib/usage/types'
import type { ChatErrorCode } from './types'

export type ResearchChatFailureCategory =
  | 'configuration'
  | 'allowance'
  | 'request_construction'
  | 'network'
  | 'provider_auth'
  | 'provider_rate_limit'
  | 'provider_unavailable'
  | 'provider_response'
  | 'structured_parse'
  | 'usage_recording'
  | 'unexpected'

type ResearchChatDiagnosticUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
}

type SafeValueKind =
  'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'undefined'

type ResearchChatSchemaIssue = {
  code: string
  path: (string | number)[]
  expected: string | null
  actualType: SafeValueKind
}

type ResearchChatSchemaDiagnostic = {
  category: 'schema_validation'
  topLevelType: SafeValueKind
  expectedKeysPresent: Record<
    'status' | 'segments' | 'explanation' | 'limitations' | 'followUps',
    boolean
  >
  segmentsCount: number | null
  followUpsCount: number | null
  issues: ResearchChatSchemaIssue[]
}

export type ResearchChatDiagnostic = {
  event: 'research_chat_failure'
  stage:
    | 'request_validation'
    | 'retrieval'
    | 'configuration'
    | 'allowance'
    | 'request_construction'
    | 'network'
    | 'provider'
    | 'provider_response'
    | 'structured_output'
    | 'structured_parse'
    | 'citation_validation'
    | 'unexpected'
  errorCode: ChatErrorCode
  failureCategory: ResearchChatFailureCategory | null
  llmKind: LlmErrorKind | 'allowance' | 'unexpected' | null
  responseCategory: LlmFailureCategory | null
  httpStatus: number | null
  provider: string | null
  requestedModel: string | null
  model: string | null
  providerCode: string | null
  requestSent: boolean | null
  responseContentPresent: boolean | null
  finishReason: string | null
  structuredContentReturned: boolean | null
  retrievalResultCount: number | null
  evidenceItemCount: number | null
  elapsedMs: number
  usage: ResearchChatDiagnosticUsage | null
  schemaValidation: ResearchChatSchemaDiagnostic | null
  /** Flat primitive for log viewers that collapse nested issue objects. */
  schemaIssueSummary: string | null
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
  failureCategory: null,
  llmKind: null,
  responseCategory: null,
  httpStatus: null,
  provider: null,
  requestedModel: null,
  model: null,
  providerCode: null,
  requestSent: null,
  responseContentPresent: null,
  finishReason: null,
  structuredContentReturned: null,
  retrievalResultCount: safeCount(context.retrievalResultCount),
  evidenceItemCount: safeCount(context.evidenceItemCount),
  elapsedMs: safeCount(context.elapsedMs) ?? 0,
  usage: null,
  schemaValidation: null,
  schemaIssueSummary: null,
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
  providerContext: {
    provider?: string
    requestedModel?: string
  } = {},
): ResearchChatDiagnostic {
  const llmError = error instanceof LlmError ? error : null
  const allowanceCheckError =
    error instanceof UsageAllowanceCheckError ? error : null
  const allowanceError =
    allowanceCheckError !== null || error instanceof UsageAllowanceExceededError
  const failureCategory: ResearchChatFailureCategory =
    allowanceCheckError?.kind === 'configuration'
      ? 'configuration'
      : allowanceError
        ? 'allowance'
        : llmError?.kind === 'configuration'
          ? llmError.diagnostic?.stage === 'request_construction'
            ? 'request_construction'
            : 'configuration'
          : llmError?.kind === 'auth'
            ? 'provider_auth'
            : llmError?.kind === 'rate_limited'
              ? 'provider_rate_limit'
              : llmError?.kind === 'timeout' || llmError?.kind === 'aborted'
                ? 'network'
                : llmError?.kind === 'provider_error'
                  ? llmError.diagnostic?.stage === 'network'
                    ? 'network'
                    : 'provider_unavailable'
                  : llmError?.kind === 'invalid_response'
                    ? llmError.diagnostic?.stage === 'structured_parse'
                      ? 'structured_parse'
                      : 'provider_response'
                    : 'unexpected'
  const stage: ResearchChatDiagnostic['stage'] =
    failureCategory === 'configuration'
      ? 'configuration'
      : failureCategory === 'allowance'
        ? 'allowance'
        : failureCategory === 'request_construction'
          ? 'request_construction'
          : failureCategory === 'network'
            ? 'network'
            : failureCategory === 'provider_response'
              ? 'provider_response'
              : failureCategory === 'structured_parse'
                ? 'structured_parse'
                : failureCategory === 'unexpected'
                  ? 'unexpected'
                  : 'provider'
  return {
    ...base(context),
    stage,
    failureCategory,
    llmKind: allowanceError ? 'allowance' : (llmError?.kind ?? 'unexpected'),
    responseCategory: llmError?.diagnostic?.category ?? null,
    httpStatus:
      llmError?.status &&
      Number.isSafeInteger(llmError.status) &&
      llmError.status >= 100 &&
      llmError.status <= 599
        ? llmError.status
        : null,
    provider:
      safeIdentifier(llmError?.diagnostic?.provider) ??
      safeIdentifier(providerContext.provider),
    requestedModel:
      safeIdentifier(llmError?.diagnostic?.requestedModel) ??
      safeIdentifier(providerContext.requestedModel),
    model: safeIdentifier(llmError?.diagnostic?.model),
    providerCode: safeIdentifier(llmError?.diagnostic?.providerCode),
    requestSent: allowanceError
      ? false
      : typeof llmError?.diagnostic?.requestSent === 'boolean'
        ? llmError.diagnostic.requestSent
        : null,
    responseContentPresent:
      typeof llmError?.diagnostic?.responseContentPresent === 'boolean'
        ? llmError.diagnostic.responseContentPresent
        : null,
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
    failureCategory: 'structured_parse',
    provider: safeIdentifier(result.provider),
    requestedModel: null,
    model: safeIdentifier(result.model),
    requestSent: true,
    responseContentPresent: true,
    finishReason: safeIdentifier(result.finishReason),
    structuredContentReturned: true,
    usage: resultUsage(result),
  }
}

const EXPECTED_KEYS = [
  'status',
  'segments',
  'explanation',
  'limitations',
  'followUps',
] as const
const SAFE_PATH_KEYS = new Set([...EXPECTED_KEYS, 'text', 'citations'])
const SAFE_EXPECTED_TYPES = new Set([
  'array',
  'object',
  'string',
  'number',
  'boolean',
  'null',
])

const valueKind = (value: unknown): SafeValueKind => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'undefined'
}

const safePath = (path: readonly PropertyKey[]): (string | number)[] =>
  path.slice(0, 6).map((part) => {
    if (typeof part === 'number') return safeCount(part) ?? -1
    return typeof part === 'string' && SAFE_PATH_KEYS.has(part)
      ? part
      : '<other>'
  })

const valueAtPath = (data: unknown, path: readonly PropertyKey[]): unknown => {
  let value = data
  for (const part of path) {
    if (
      (typeof part !== 'string' && typeof part !== 'number') ||
      value === null ||
      typeof value !== 'object'
    ) {
      return undefined
    }
    value = (value as Record<PropertyKey, unknown>)[part]
  }
  return value
}

/**
 * Zod issue messages and model values are deliberately excluded. Only whitelisted
 * schema paths, fixed issue codes, value kinds, key presence, and array sizes survive.
 */
export function researchChatSchemaFailureDiagnostic(
  context: Context,
  result: StructuredResult,
  issues: readonly {
    code: string
    path: readonly PropertyKey[]
    expected?: unknown
  }[],
): ResearchChatDiagnostic {
  const data = result.data
  const record = data
  const present = Object.fromEntries(
    EXPECTED_KEYS.map((key) => [
      key,
      Object.prototype.hasOwnProperty.call(record, key),
    ]),
  ) as ResearchChatSchemaDiagnostic['expectedKeysPresent']
  const safeIssues = issues.slice(0, 20).map((issue) => ({
    code: safeIdentifier(issue.code) ?? 'unknown',
    path: safePath(issue.path),
    expected:
      typeof issue.expected === 'string' &&
      SAFE_EXPECTED_TYPES.has(issue.expected)
        ? issue.expected
        : null,
    actualType: valueKind(valueAtPath(data, issue.path)),
  }))
  const schemaIssueSummary = safeIssues
    .map((issue) => {
      const path = issue.path
        .map((part) => (typeof part === 'number' ? `[${part}]` : part))
        .join('.')
        .replace(/\.\[/g, '[')
      return `${issue.code}|path=${path || '<root>'}|expected=${issue.expected ?? 'n/a'}|actual=${issue.actualType}`.slice(
        0,
        180,
      )
    })
    .join('; ')
    .slice(0, 2_000)

  return {
    ...researchChatResultFailureDiagnostic(
      'structured_output',
      context,
      result,
    ),
    schemaValidation: {
      category: 'schema_validation',
      topLevelType: valueKind(data),
      expectedKeysPresent: present,
      segmentsCount: Array.isArray(record.segments)
        ? safeCount(record.segments.length)
        : null,
      followUpsCount: Array.isArray(record.followUps)
        ? safeCount(record.followUps.length)
        : null,
      issues: safeIssues,
    },
    schemaIssueSummary: schemaIssueSummary || null,
  }
}

/** Production-safe and content-free. Callers can only supply the fixed shape above. */
export function logResearchChatDiagnostic(
  diagnostic: ResearchChatDiagnostic,
): void {
  console.warn('[research-chat]', diagnostic)
}
