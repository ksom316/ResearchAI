import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServiceRoleClient } from '#/lib/supabase/supabase.server'
import { TrustedSupabaseConfigurationError } from '#/lib/supabase/trusted-config.server'
import { UsageAllowanceCheckError } from './types'
import type { UsageAllowanceChecker, UsageAllowanceStatus } from './types'

const count = z.coerce.number().int().min(0)
const rowSchema = z.object({
  period_start: z.string().datetime({ offset: true }),
  period_end: z.string().datetime({ offset: true }),
  requests_used: count,
  request_limit: count.positive(),
  requests_remaining: count,
  tokens_used: count,
  token_limit: count.positive(),
  tokens_remaining: count,
  request_percent: count.max(100),
  token_percent: count.max(100),
  percentage_used: count.max(100),
  allowed: z.boolean(),
  exhausted_reason: z.enum(['requests', 'tokens']).nullable(),
})

export function parseUsageAllowanceRow(value: unknown): UsageAllowanceStatus {
  const parsed = rowSchema.safeParse(Array.isArray(value) ? value[0] : value)
  if (!parsed.success) throw new Error('AI allowance data is unavailable')
  const row = parsed.data
  return {
    periodStart: row.period_start,
    periodEnd: row.period_end,
    requestsUsed: row.requests_used,
    requestLimit: row.request_limit,
    requestsRemaining: row.requests_remaining,
    tokensUsed: row.tokens_used,
    tokenLimit: row.token_limit,
    tokensRemaining: row.tokens_remaining,
    requestPercent: row.request_percent,
    tokenPercent: row.token_percent,
    percentageUsed: row.percentage_used,
    allowed: row.allowed,
    exhaustedReason: row.exhausted_reason,
  }
}

export function createSupabaseUsageAllowanceChecker(
  client: SupabaseClient,
): UsageAllowanceChecker {
  return async (actorUserId) => {
    const { data, error } = await client.rpc('get_ai_allowance_for_actor', {
      p_actor_user_id: actorUserId,
    })
    if (error) throw new UsageAllowanceCheckError('request')
    try {
      return parseUsageAllowanceRow(data)
    } catch {
      throw new UsageAllowanceCheckError('response')
    }
  }
}

export function createServerUsageAllowanceChecker(): UsageAllowanceChecker {
  let checker: UsageAllowanceChecker | null = null
  return async (actorUserId) => {
    try {
      checker ??= createSupabaseUsageAllowanceChecker(
        createSupabaseServiceRoleClient(),
      )
      return await checker(actorUserId)
    } catch (error) {
      if (error instanceof UsageAllowanceCheckError) throw error
      if (error instanceof TrustedSupabaseConfigurationError) {
        throw new UsageAllowanceCheckError('configuration')
      }
      throw new UsageAllowanceCheckError('request')
    }
  }
}
