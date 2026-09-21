import type {
  ClaimCheckClaimId,
  ClaimCheckResult,
  ClaimSupportAssessment,
} from '#/features/claim-checker/types'

export type AssessmentByUnitId = Readonly<
  Partial<Record<ClaimCheckClaimId, ClaimSupportAssessment>>
>

export function resetAssessments(): AssessmentByUnitId {
  return {}
}

/** Only a fully validated assessed result may enter ephemeral draft state. */
export function applyClaimCheckResult(
  current: AssessmentByUnitId,
  unitId: ClaimCheckClaimId,
  result: ClaimCheckResult,
): AssessmentByUnitId {
  if (
    !result.ok ||
    result.status !== 'assessed' ||
    result.assessment.claimId !== unitId
  ) {
    return current
  }
  return { ...current, [unitId]: result.assessment }
}
