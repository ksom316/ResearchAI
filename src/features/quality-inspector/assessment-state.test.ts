import { describe, expect, it } from 'vitest'
import type {
  ClaimCheckResult,
  ClaimSupportAssessment,
} from '#/features/claim-checker/types'
import { applyClaimCheckResult, resetAssessments } from './assessment-state'
import type { AssessmentByUnitId } from './assessment-state'

const assessment = (
  claimId: `U${number}`,
  support: ClaimSupportAssessment['overallSupport'],
  summary: string = support,
): ClaimSupportAssessment => ({
  claimId,
  overallSupport: support,
  summary,
  unsupportedFragments: [],
  citations: [],
})

const assessed = (value: ClaimSupportAssessment): ClaimCheckResult => ({
  ok: true,
  status: 'assessed',
  assessment: value,
})

describe('ephemeral draft assessment lifecycle', () => {
  it('stores a successful validated check', () => {
    const next = applyClaimCheckResult({}, 'U1', assessed(assessment('U1', 'supported')))
    expect(next.U1?.overallSupport).toBe('supported')
  })

  it('replaces only the successfully rechecked unit', () => {
    const current: AssessmentByUnitId = {
      U1: assessment('U1', 'partially_supported', 'old'),
      U2: assessment('U2', 'supported', 'untouched'),
    }
    const next = applyClaimCheckResult(
      current,
      'U1',
      assessed(assessment('U1', 'unsupported', 'new')),
    )
    expect(next.U1?.summary).toBe('new')
    expect(next.U2).toBe(current.U2)
  })

  it('preserves prior success after a failed recheck', () => {
    const current = { U1: assessment('U1', 'supported') }
    expect(
      applyClaimCheckResult(current, 'U1', {
        ok: false,
        error: 'checker_timeout',
      }),
    ).toBe(current)
  })

  it('leaves an initially failed or insufficient check unchecked', () => {
    const failed = applyClaimCheckResult({}, 'U1', {
      ok: false,
      error: 'invalid_assessment',
    })
    const insufficient = applyClaimCheckResult(failed, 'U1', {
      ok: true,
      status: 'insufficient_evidence',
      stage: 'evidence',
      claimId: 'U1',
      reason: 'evidence_missing',
      explanation: 'Unavailable.',
    })
    expect(insufficient).toEqual({})
  })

  it('rejects a mismatched result identity', () => {
    const current = { U1: assessment('U1', 'supported') }
    expect(
      applyClaimCheckResult(
        current,
        'U1',
        assessed(assessment('U2', 'unsupported')),
      ),
    ).toBe(current)
  })

  it('clears every old assessment for a new draft', () => {
    expect(resetAssessments()).toEqual({})
    expect(resetAssessments()).not.toBe(resetAssessments())
  })
})
