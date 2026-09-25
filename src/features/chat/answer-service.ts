import { runSemanticSearch } from '#/features/search/search-service'
import type { SearchDeps } from '#/features/search/search-service'
import type { SearchErrorCode } from '#/features/search/types'
import { LlmError } from '#/lib/llm'
import type { LlmProvider, StructuredResult } from '#/lib/llm'
import { UsageAllowanceExceededError } from '#/lib/usage/types'
import { buildEvidence, MAX_EVIDENCE_HITS } from './evidence'
import { buildUserMessage, SYSTEM_PROMPT } from './prompt'
import {
  ANSWER_JSON_SCHEMA,
  askRequestSchema,
  modelAnswerSchema,
} from './schemas'
import type { AskOutcome, ChatErrorCode } from './types'
import { validateAnswer } from './validate-answer'
import {
  researchChatFailureDiagnostic,
  researchChatProviderFailureDiagnostic,
  researchChatResultFailureDiagnostic,
  researchChatSchemaFailureDiagnostic,
} from './diagnostics'
import type { ResearchChatDiagnostic } from './diagnostics'

/** Server-controlled retrieval settings. The client cannot change any of them. */
export const RETRIEVAL_SETTINGS = {
  limit: MAX_EVIDENCE_HITS,
  minSimilarity: null,
  includeReferences: false,
} as const

/**
 * Bounded headroom for the JSON envelope plus the runtime-supported answer limits.
 * Reasoning is disabled below so routed reasoning models cannot spend this budget on
 * hidden reasoning instead of completing the structured response.
 */
export const MAX_OUTPUT_TOKENS = 3000

export type AnswerDeps = {
  search: SearchDeps
  /** Called only once evidence exists, so missing LLM config never breaks no_evidence. */
  getLlm: () => LlmProvider
  /** Per-request delimiter nonce; injectable for tests. */
  nonce?: () => string
  /** Server-owned, content-free failure telemetry. */
  diagnostic?: (diagnostic: ResearchChatDiagnostic) => void
}

const fail = (error: ChatErrorCode, resetDate?: string): AskOutcome => ({
  ok: false,
  error,
  ...(resetDate ? { resetDate } : {}),
})

const searchError = (code: SearchErrorCode): ChatErrorCode => code

function llmError(error: unknown): {
  code: ChatErrorCode
  resetDate?: string
} {
  if (error instanceof UsageAllowanceExceededError)
    return { code: 'usage_exhausted', resetDate: error.resetDate }
  if (error instanceof LlmError) {
    if (error.kind === 'rate_limited') return { code: 'answer_busy' }
    if (error.kind === 'timeout') return { code: 'answer_timeout' }
  }
  return { code: 'answer_unavailable' }
}

/**
 * Question -> existing retrieval -> evidence -> ONE LLM call -> zod -> citation
 * validation. Single turn, stateless, no retries, no fallbacks. Nothing raw from the
 * search layer or the provider is ever returned.
 */
export async function runGroundedAnswer(
  raw: unknown,
  deps: AnswerDeps,
): Promise<AskOutcome> {
  const startedAt = Date.now()
  const elapsedMs = () => Date.now() - startedAt
  const emit = (diagnostic: ResearchChatDiagnostic) =>
    deps.diagnostic?.(diagnostic)
  const parsed = askRequestSchema.safeParse(raw)
  if (!parsed.success) {
    emit(
      researchChatFailureDiagnostic('request_validation', {
        errorCode: 'invalid_request',
        elapsedMs: elapsedMs(),
      }),
    )
    return fail('invalid_request')
  }
  const { question, scope } = parsed.data

  try {
    const search = await runSemanticSearch(
      { query: question, scope, ...RETRIEVAL_SETTINGS },
      deps.search,
    )
    if (!search.ok) {
      const errorCode = searchError(search.error)
      emit(
        researchChatFailureDiagnostic('retrieval', {
          errorCode,
          elapsedMs: elapsedMs(),
        }),
      )
      return fail(errorCode)
    }

    const noEvidence = (): AskOutcome => ({
      ok: true,
      status: 'no_evidence',
      segments: [],
      citations: [],
      explanation: null,
      limitations: null,
      followUps: [],
      coverage: search.coverage,
    })
    if (search.status === 'nothing_searchable') return noEvidence()

    const evidence = buildEvidence(search.results)
    if (evidence.items.length === 0) return noEvidence()

    let result: StructuredResult
    let llm: LlmProvider | null = null
    try {
      llm = deps.getLlm()
      result = await llm.generateStructured({
        system: SYSTEM_PROMPT,
        user: buildUserMessage({
          question,
          evidence: evidence.items,
          nonce: (deps.nonce ?? (() => globalThis.crypto.randomUUID()))(),
        }),
        schema: ANSWER_JSON_SCHEMA,
        maxTokens: MAX_OUTPUT_TOKENS,
        reasoning: { effort: 'none' },
      })
    } catch (error) {
      const failure = llmError(error)
      const errorCode = failure.code
      emit(
        researchChatProviderFailureDiagnostic(
          {
            errorCode,
            retrievalResultCount: search.results.length,
            evidenceItemCount: evidence.items.length,
            elapsedMs: elapsedMs(),
          },
          error,
          {
            provider: llm?.providerName,
            requestedModel: llm?.modelName,
          },
        ),
      )
      return fail(errorCode, failure.resetDate)
    }

    const answer = modelAnswerSchema.safeParse(result.data)
    if (!answer.success) {
      emit(
        researchChatSchemaFailureDiagnostic(
          {
            errorCode: 'answer_unavailable',
            retrievalResultCount: search.results.length,
            evidenceItemCount: evidence.items.length,
            elapsedMs: elapsedMs(),
          },
          result,
          answer.error.issues,
        ),
      )
      return fail('answer_unavailable')
    }
    const validated = validateAnswer(answer.data, evidence.byId)
    if (!validated) {
      emit(
        researchChatResultFailureDiagnostic(
          'citation_validation',
          {
            errorCode: 'answer_unavailable',
            retrievalResultCount: search.results.length,
            evidenceItemCount: evidence.items.length,
            elapsedMs: elapsedMs(),
          },
          result,
        ),
      )
      return fail('answer_unavailable')
    }

    return { ok: true, ...validated, coverage: search.coverage }
  } catch {
    emit(
      researchChatFailureDiagnostic('unexpected', {
        errorCode: 'answer_unavailable',
        elapsedMs: elapsedMs(),
      }),
    )
    return fail('answer_unavailable')
  }
}
