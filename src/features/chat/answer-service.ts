import { runSemanticSearch } from '#/features/search/search-service'
import type { SearchDeps } from '#/features/search/search-service'
import type { SearchErrorCode } from '#/features/search/types'
import { LlmError } from '#/lib/llm'
import type { LlmProvider } from '#/lib/llm'
import { buildEvidence, MAX_EVIDENCE_HITS } from './evidence'
import { buildUserMessage, SYSTEM_PROMPT } from './prompt'
import {
  ANSWER_JSON_SCHEMA,
  askRequestSchema,
  modelAnswerSchema,
} from './schemas'
import type { AskOutcome, ChatErrorCode } from './types'
import { validateAnswer } from './validate-answer'

/** Server-controlled retrieval settings. The client cannot change any of them. */
export const RETRIEVAL_SETTINGS = {
  limit: MAX_EVIDENCE_HITS,
  minSimilarity: null,
  includeReferences: false,
} as const

export const MAX_OUTPUT_TOKENS = 1000

export type AnswerDeps = {
  search: SearchDeps
  /** Called only once evidence exists, so missing LLM config never breaks no_evidence. */
  getLlm: () => LlmProvider
  /** Per-request delimiter nonce; injectable for tests. */
  nonce?: () => string
}

const fail = (error: ChatErrorCode): AskOutcome => ({ ok: false, error })

const searchError = (code: SearchErrorCode): ChatErrorCode => code

function llmError(error: unknown): ChatErrorCode {
  if (error instanceof LlmError) {
    if (error.kind === 'rate_limited') return 'answer_busy'
    if (error.kind === 'timeout') return 'answer_timeout'
  }
  return 'answer_unavailable'
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
  const parsed = askRequestSchema.safeParse(raw)
  if (!parsed.success) return fail('invalid_request')
  const { question, scope } = parsed.data

  try {
    const search = await runSemanticSearch(
      { query: question, scope, ...RETRIEVAL_SETTINGS },
      deps.search,
    )
    if (!search.ok) return fail(searchError(search.error))

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

    let data: Record<string, unknown>
    try {
      const result = await deps.getLlm().generateStructured({
        system: SYSTEM_PROMPT,
        user: buildUserMessage({
          question,
          evidence: evidence.items,
          nonce: (deps.nonce ?? (() => globalThis.crypto.randomUUID()))(),
        }),
        schema: ANSWER_JSON_SCHEMA,
        maxTokens: MAX_OUTPUT_TOKENS,
      })
      data = result.data
    } catch (error) {
      return fail(llmError(error))
    }

    const answer = modelAnswerSchema.safeParse(data)
    if (!answer.success) return fail('answer_unavailable')
    const validated = validateAnswer(answer.data, evidence.byId)
    if (!validated) return fail('answer_unavailable')

    return { ok: true, ...validated, coverage: search.coverage }
  } catch {
    return fail('answer_unavailable')
  }
}
