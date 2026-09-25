import { describe, expect, it, vi } from 'vitest'
import {
  createSupabaseUsageAllowanceChecker,
  parseUsageAllowanceRow,
} from './allowance.server'

const row = {
  period_start: '2026-09-01T00:00:00+00:00',
  period_end: '2026-10-01T00:00:00+00:00',
  requests_used: 42,
  request_limit: 100,
  requests_remaining: 58,
  tokens_used: 87000,
  token_limit: 250000,
  tokens_remaining: 163000,
  request_percent: 42,
  token_percent: 34,
  percentage_used: 42,
  allowed: true,
  exhausted_reason: null,
}

describe('AI usage allowance checker', () => {
  it('parses the database summary without changing measured values', () => {
    expect(parseUsageAllowanceRow([row])).toEqual({
      periodStart: row.period_start,
      periodEnd: row.period_end,
      requestsUsed: 42,
      requestLimit: 100,
      requestsRemaining: 58,
      tokensUsed: 87000,
      tokenLimit: 250000,
      tokensRemaining: 163000,
      requestPercent: 42,
      tokenPercent: 34,
      percentageUsed: 42,
      allowed: true,
      exhaustedReason: null,
    })
  })

  it('checks the invoking collaborator rather than a project owner', async () => {
    const rpc = vi.fn(async () => ({ data: [row], error: null }))
    const checker = createSupabaseUsageAllowanceChecker({ rpc } as never)

    await checker('collaborator-user-id')

    expect(rpc).toHaveBeenCalledWith('get_ai_allowance_for_actor', {
      p_actor_user_id: 'collaborator-user-id',
    })
  })
})
