import { describe, expect, it } from 'vitest'
import type { ClaimCheckResult } from './types'
import {
  buildClaimCheckRequest,
  CLAIM_SUPPORT_LABELS,
  claimCheckResultMessage,
} from './presentation'

const projectId = '11111111-1111-4111-8111-111111111111'
const locator = {
  kind: 'chunk' as const,
  paperId: '22222222-2222-4222-8222-222222222222',
  chunkId: '33333333-3333-4333-8333-333333333333',
  sectionId: '44444444-4444-4444-8444-444444444444',
}

describe('Claim Checker presentation', () => {
  it('builds only the strict selector request from a Writer unit', () => {
    expect(
      buildClaimCheckRequest(projectId, 'U1', ' A grounded claim. ', [
        { citationId: 'W1', locator },
      ]),
    ).toEqual({
      projectId,
      claimId: 'U1',
      claimText: 'A grounded claim.',
      citations: [{ citationId: 'W1', locator }],
    })
  })

  it('rejects invalid unit identifiers and duplicate selectors', () => {
    expect(
      buildClaimCheckRequest(projectId, 'claim-1', 'Claim', [
        { citationId: 'W1', locator },
      ]),
    ).toBeNull()
    expect(
      buildClaimCheckRequest(projectId, 'U1', 'Claim', [
        { citationId: 'W1', locator },
        { citationId: 'W1', locator },
      ]),
    ).toBeNull()
  })

  it('preserves every evidence selector when UI numbering collapses the paper', () => {
    const secondLocator = {
      ...locator,
      chunkId: '55555555-5555-4555-8555-555555555555',
    }
    const request = buildClaimCheckRequest(projectId, 'U2', 'Compound claim.', [
      { citationId: 'W1', locator },
      { citationId: 'W2', locator: secondLocator },
    ])
    expect(request?.citations).toEqual([
      { citationId: 'W1', locator },
      { citationId: 'W2', locator: secondLocator },
    ])
  })

  it('uses conservative evidence-support labels', () => {
    expect(CLAIM_SUPPORT_LABELS).toEqual({
      supported: 'Supported by cited evidence',
      partially_supported: 'Partially supported by cited evidence',
      unsupported: 'Not supported by cited evidence',
      insufficient_evidence: 'Insufficient cited evidence',
    })
    expect(Object.values(CLAIM_SUPPORT_LABELS).join(' ')).not.toMatch(
      /\b(?:true|false|fact|verified|proven|hallucination)\b/i,
    )
  })

  it.each([
    ['stale_evidence', 'out of date'],
    ['evidence_missing', 'no longer available'],
    ['paper_not_ready', 'no longer ready'],
    ['no_usable_source', 'usable source text'],
    ['evidence_budget_exceeded', 'too large'],
  ] as const)('maps %s abstention safely', (reason, expected) => {
    const result: ClaimCheckResult = {
      ok: true,
      status: 'insufficient_evidence',
      stage: 'evidence',
      claimId: 'U1',
      reason,
      explanation: 'server explanation is not rendered',
    }
    expect(claimCheckResultMessage(result)).toContain(expected)
    expect(claimCheckResultMessage(result)).not.toContain('server explanation')
  })

  it.each([
    'checker_busy',
    'checker_timeout',
    'checker_unavailable',
    'checker_truncated',
    'invalid_output',
    'invalid_assessment',
  ] as const)('maps %s without exposing provider output', (error) => {
    const message = claimCheckResultMessage({ ok: false, error })
    expect(message).toBeTruthy()
    expect(message).not.toMatch(/prompt|provider response|stack|api key/i)
  })
})
