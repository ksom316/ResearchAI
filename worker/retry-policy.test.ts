import { describe, expect, it } from 'vitest'
import { decideFailure } from './retry-policy'

describe('decideFailure', () => {
  it('retries transient failures while attempts remain', () => {
    expect(decideFailure('storage_error', 1, 3)).toBe('retry')
    expect(decideFailure('persistence_error', 2, 3)).toBe('retry')
  })

  it('stops retrying once attempts are exhausted (bounded)', () => {
    expect(decideFailure('storage_error', 3, 3)).toBe('fail')
    expect(decideFailure('persistence_error', 4, 3)).toBe('fail')
    expect(decideFailure('storage_error', 1, 1)).toBe('fail')
  })

  it.each([
    'invalid_pdf',
    'encrypted_pdf',
    'no_extractable_text',
    'extraction_failed',
    'timeout',
  ] as const)('never retries deterministic failure %s', (code) => {
    expect(decideFailure(code, 1, 3)).toBe('fail')
  })

  it('every job ends within maxAttempts tries', () => {
    for (const max of [1, 2, 3, 5]) {
      let attempts = 0
      let decision = 'retry'
      while (decision === 'retry') {
        attempts++
        decision = decideFailure('storage_error', attempts, max)
        expect(attempts).toBeLessThanOrEqual(max)
      }
      expect(attempts).toBe(max)
    }
  })
})
