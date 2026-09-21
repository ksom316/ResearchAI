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

type SafeValueKind =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'undefined'

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
