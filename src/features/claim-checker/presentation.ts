import { claimCheckRequestSchema } from './schemas'
import { allowanceReachedMessage } from '#/lib/usage/presentation'
import type {
  ClaimCheckAbstentionReason,
  ClaimCheckAssessmentError,
  ClaimCheckCitationSelector,
  ClaimCheckResult,
  ClaimSupport,
  NormalizedClaimCheckRequest,
} from './types'

export const CLAIM_SUPPORT_LABELS: Record<ClaimSupport, string> = {
  supported: 'Supported by cited evidence',
  partially_supported: 'Partially supported by cited evidence',
  unsupported: 'Not supported by cited evidence',
  insufficient_evidence: 'Insufficient cited evidence',
}

const ABSTENTION_MESSAGES: Record<ClaimCheckAbstentionReason, string> = {
  stale_evidence:
    'The cited research intelligence is out of date. Refresh the affected paper intelligence before checking support.',
  evidence_missing:
    'Some cited evidence is no longer available. Generate a new grounded draft before checking support.',
  paper_not_ready:
    'A cited paper is no longer ready for evidence checking. Process the paper before trying again.',
  no_usable_source:
    'The citations do not currently contain enough usable source text for an assessment.',
  evidence_budget_exceeded:
    'The cited evidence is too large to assess safely in one request.',
}

const ERROR_MESSAGES: Record<ClaimCheckAssessmentError, string> = {
  invalid_request: 'This generated statement cannot be checked safely.',
  unauthenticated: 'Your session has expired. Sign in again to check support.',
  scope_not_found: 'This project or its cited evidence is no longer available.',
  evidence_unavailable: 'The cited evidence could not be loaded right now.',
  checker_busy: 'Claim Checker is busy. Try again in a moment.',
  checker_timeout: 'The support assessment timed out. No result was displayed.',
  usage_exhausted:
    "You've reached your AI usage allowance for this month. Your allowance resets at the start of next month.",
  checker_unavailable: 'Claim Checker is temporarily unavailable.',
  checker_truncated:
    'The support assessment was truncated and could not be safely displayed.',
  invalid_output:
    'The support assessment could not be safely verified. No result was displayed.',
  invalid_assessment:
    'The support assessment did not pass source validation. No result was displayed.',
}

export function buildClaimCheckRequest(
  projectId: string,
  claimId: string,
  claimText: string,
  citations: readonly ClaimCheckCitationSelector[],
): NormalizedClaimCheckRequest | null {
  const parsed = claimCheckRequestSchema.safeParse({
    projectId,
    claimId,
    claimText,
    citations: citations.map(({ citationId, locator }) => ({
      citationId,
      locator,
    })),
  })
  return parsed.success ? (parsed.data as NormalizedClaimCheckRequest) : null
}

export function claimCheckResultMessage(
  result: ClaimCheckResult,
): string | null {
  if (!result.ok)
    return result.error === 'usage_exhausted'
      ? allowanceReachedMessage(result.resetDate)
      : ERROR_MESSAGES[result.error]
  if (result.status === 'assessed') return null
  return ABSTENTION_MESSAGES[result.reason]
}
