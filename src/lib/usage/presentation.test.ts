import { describe, expect, it } from 'vitest'
import { allowanceReachedMessage } from './presentation'

describe('allowance reached copy', () => {
  it('uses the authoritative reset date without exposing internals', () => {
    const message = allowanceReachedMessage('2026-10-01T00:00:00.000Z')

    expect(message).toBe(
      "You've reached your AI usage allowance for this month. Your allowance resets on October 1.",
    )
    expect(message).not.toMatch(/provider|database|token|OpenRouter/i)
  })
})
