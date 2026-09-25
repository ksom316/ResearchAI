import { LlmError } from '#/lib/llm'
import type { LlmProvider, ReasoningConfig } from '#/lib/llm'
import { UsageAllowanceExceededError } from '#/lib/usage/types'
import {
  claimCheckProviderDiagnostic,
  claimCheckResultDiagnostic,
  logClaimCheckDiagnostic,
} from './diagnostics.server'
import type { ClaimCheckDiagnostic } from './diagnostics.server'
import type { WriterDb } from '#/features/writer/writer-db.server'
import { prepareClaimCheckEvidence } from './evidence'
import { CLAIM_CHECK_JSON_SCHEMA } from './model-schema'
import { buildClaimCheckUserMessage, CLAIM_CHECK_SYSTEM_PROMPT } from './prompt'
import type {
  ClaimCheckAssessmentError,
  ClaimCheckEvidenceResult,
  ClaimCheckResult,
} from './types'
import { validateClaimAssessment } from './validate-assessment'

export const MAX_CLAIM_CHECK_OUTPUT_TOKENS = 1_200
export const CLAIM_CHECK_REASONING: ReasoningConfig = { effort: 'none' }

export const CLAIM_CHECK_ABSTENTION_EXPLANATIONS = {
  stale_evidence:
    'The cited evidence is out of date and cannot be assessed safely.',
  evidence_missing:
    'One or more cited evidence records are no longer available.',
  paper_not_ready:
    'A cited paper is not currently ready for evidence assessment.',
  no_usable_source:
    'The citations do not contain enough usable source text for an assessment.',
  evidence_budget_exceeded:
    'The complete cited evidence set is too large to assess safely in one request.',
} as const

export type ClaimCheckAssessmentDeps = {
  prepareEvidence?: (
    raw: unknown,
    deps: { db: WriterDb },
  ) => Promise<ClaimCheckEvidenceResult>
  db: WriterDb
  getLlm: () => LlmProvider
  nonce?: () => string
  signal?: AbortSignal
  diagnosticsEnabled?: boolean
  logDiagnostic?: (diagnostic: ClaimCheckDiagnostic) => void
}

function providerError(error: unknown): {
  code: ClaimCheckAssessmentError
  resetDate?: string
} {
  if (error instanceof UsageAllowanceExceededError)
    return { code: 'usage_exhausted', resetDate: error.resetDate }
  if (!(error instanceof LlmError)) return { code: 'checker_unavailable' }
  if (error.kind === 'rate_limited') return { code: 'checker_busy' }
  if (error.kind === 'timeout') return { code: 'checker_timeout' }
  if (
    error.kind === 'invalid_response' &&
    error.diagnostic?.category === 'truncated'
  ) {
    return { code: 'checker_truncated' }
  }
  if (error.kind === 'invalid_response') return { code: 'invalid_output' }
  return { code: 'checker_unavailable' }
}

function report(
  deps: ClaimCheckAssessmentDeps,
  diagnostic: ClaimCheckDiagnostic,
) {
  if (deps.logDiagnostic) deps.logDiagnostic(diagnostic)
  else logClaimCheckDiagnostic(diagnostic, deps.diagnosticsEnabled)
}

/** Strict request -> authorized 7B.2 evidence -> one call -> fail-closed result. */
export async function assessClaimSupport(
  raw: unknown,
  deps: ClaimCheckAssessmentDeps,
): Promise<ClaimCheckResult> {
  let prepared: ClaimCheckEvidenceResult
  try {
    prepared = await (deps.prepareEvidence ?? prepareClaimCheckEvidence)(raw, {
      db: deps.db,
    })
  } catch {
    return { ok: false, error: 'evidence_unavailable' }
  }
  if (!prepared.ok) return prepared
  if (prepared.status !== 'ready') {
    return {
      ok: true,
      status: 'insufficient_evidence',
      stage: 'evidence',
      claimId: prepared.request.claimId,
      reason: prepared.reason,
      explanation: CLAIM_CHECK_ABSTENTION_EXPLANATIONS[prepared.reason],
    }
  }

  let result
  try {
    result = await deps.getLlm().generateStructured({
      system: CLAIM_CHECK_SYSTEM_PROMPT,
      user: buildClaimCheckUserMessage({
        evidence: prepared.evidence,
        nonce: (deps.nonce ?? (() => globalThis.crypto.randomUUID()))(),
      }),
      schema: CLAIM_CHECK_JSON_SCHEMA,
      maxTokens: MAX_CLAIM_CHECK_OUTPUT_TOKENS,
      reasoning: CLAIM_CHECK_REASONING,
      signal: deps.signal,
    })
  } catch (error) {
    const failure = providerError(error)
    const errorCode = failure.code
    report(deps, claimCheckProviderDiagnostic(errorCode, error))
    return {
      ok: false,
      error: errorCode,
      ...(failure.resetDate ? { resetDate: failure.resetDate } : {}),
    }
  }

  if (result.finishReason === 'length') {
    report(
      deps,
      claimCheckResultDiagnostic(
        'structured_response',
        'checker_truncated',
        result,
      ),
    )
    return { ok: false, error: 'checker_truncated' }
  }

  const validated = validateClaimAssessment(result.data, {
    request: prepared.request,
    evidence: prepared.evidence,
  })
  if (!validated.ok) {
    report(
      deps,
      claimCheckResultDiagnostic('validation', validated.error, result),
    )
    return validated
  }
  return { ok: true, status: 'assessed', assessment: validated.assessment }
}
