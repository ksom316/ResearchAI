import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { parseUsageAllowanceRow } from '#/lib/usage/allowance.server'
import type { UsageSummary } from '#/lib/usage/types'

const monthSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
})

export const currentUsageMonth = () => {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function bounds(month: string): { start: string; end: string } {
  const [year, value] = month.split('-').map(Number)
  const start = new Date(Date.UTC(year, value - 1, 1))
  const end = new Date(Date.UTC(year, value, 1))
  return { start: start.toISOString(), end: end.toISOString() }
}

const count = z.coerce.number().int().min(0)
const nullableCount = count.nullable()
const summaryRow = z.object({
  ai_requests: count,
  input_tokens: nullableCount,
  output_tokens: nullableCount,
  total_tokens: nullableCount,
  papers_processed: count,
  paper_pages: nullableCount,
  embedding_chunks: count,
  embedding_requests: count,
  embedding_tokens: nullableCount,
  storage_bytes: nullableCount,
  feature_breakdown: z.record(z.string(), count),
})

export const getUsageSummaryFn = createServerFn({ method: 'GET' })
  .validator(monthSchema)
  .handler(async ({ data }): Promise<UsageSummary> => {
    const supabase = createSupabaseServerClient()
    const { start, end } = bounds(data.month)
    const { data: rows, error } = await supabase.rpc('get_my_usage_summary', {
      p_period_start: start,
      p_period_end: end,
    })
    if (error) throw new Error('Usage data is unavailable.')
    const parsed = summaryRow.safeParse(Array.isArray(rows) ? rows[0] : rows)
    if (!parsed.success) throw new Error('Usage data is unavailable.')
    const row = parsed.data
    const { data: allowanceRows, error: allowanceError } = await supabase.rpc(
      'get_my_ai_allowance',
    )
    if (allowanceError) throw new Error('Usage data is unavailable.')
    const allowance = parseUsageAllowanceRow(allowanceRows)
    const { data: storageRows, error: storageError } = await supabase.rpc(
      'get_my_storage_summary',
    )
    if (storageError) throw new Error('Storage data is unavailable.')
    const storage = Array.isArray(storageRows) ? storageRows[0] : storageRows
    const storageParsed = z
      .object({
        storage_bytes: count,
        storage_capacity_bytes: count,
        storage_remaining_bytes: count,
        storage_percent: count,
      })
      .safeParse(storage)
    if (!storageParsed.success) throw new Error('Storage data is unavailable.')
    return {
      month: data.month,
      aiRequests: allowance.requestsUsed,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
      papersProcessed: row.papers_processed,
      paperPages: row.paper_pages,
      embeddingChunks: row.embedding_chunks,
      embeddingRequests: row.embedding_requests,
      embeddingTokens: row.embedding_tokens,
      storageBytes: storageParsed.data.storage_bytes,
      storageCapacityBytes: storageParsed.data.storage_capacity_bytes,
      storageRemainingBytes: storageParsed.data.storage_remaining_bytes,
      storagePercent: storageParsed.data.storage_percent,
      allowancePeriodStart: allowance.periodStart,
      allowancePeriodEnd: allowance.periodEnd,
      aiRequestLimit: allowance.requestLimit,
      aiRequestsRemaining: allowance.requestsRemaining,
      aiRequestPercent: allowance.requestPercent,
      aiTokenLimit: allowance.tokenLimit,
      aiTokensUsed: allowance.tokensUsed,
      aiTokensRemaining: allowance.tokensRemaining,
      aiTokenPercent: allowance.tokenPercent,
      aiAllowancePercent: allowance.percentageUsed,
      aiAllowanceReached: !allowance.allowed,
      featureBreakdown: Object.entries(row.feature_breakdown)
        .map(([feature, requests]) => ({
          feature:
            feature as UsageSummary['featureBreakdown'][number]['feature'],
          requests,
        }))
        .sort(
          (a, b) =>
            b.requests - a.requests || a.feature.localeCompare(b.feature),
        ),
    }
  })
