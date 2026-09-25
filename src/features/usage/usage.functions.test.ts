import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getUsageSummaryFn } from './usage.functions'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = {
      validator: () => builder,
      handler: (handler: unknown) => handler,
    }
    return builder
  },
}))

vi.mock('#/lib/supabase/supabase.server', () => ({
  createSupabaseServerClient: () => ({ rpc }),
}))

const usageRow = {
  ai_requests: 4,
  input_tokens: 100,
  output_tokens: 50,
  total_tokens: 150,
  papers_processed: 2,
  paper_pages: 12,
  embedding_chunks: 20,
  embedding_requests: 1,
  embedding_tokens: 80,
  storage_bytes: 999,
  feature_breakdown: { research_chat: 3, academic_writer: 1 },
}

describe('getUsageSummaryFn', () => {
  beforeEach(() => rpc.mockReset())

  it('combines metered usage with the authoritative storage summary', async () => {
    rpc
      .mockResolvedValueOnce({ data: [usageRow], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            period_start: '2026-09-01T00:00:00.000Z',
            period_end: '2026-10-01T00:00:00.000Z',
            requests_used: 4,
            request_limit: 100,
            requests_remaining: 96,
            tokens_used: 150,
            token_limit: 250000,
            tokens_remaining: 249850,
            request_percent: 4,
            token_percent: 0,
            percentage_used: 4,
            allowed: true,
            exhausted_reason: null,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            storage_bytes: 1048576,
            storage_capacity_bytes: 209715200,
            storage_remaining_bytes: 208666624,
            storage_percent: 0,
          },
        ],
        error: null,
      })

    const result = await getUsageSummaryFn({ data: { month: '2026-09' } })

    expect(rpc).toHaveBeenNthCalledWith(1, 'get_my_usage_summary', {
      p_period_start: '2026-09-01T00:00:00.000Z',
      p_period_end: '2026-10-01T00:00:00.000Z',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_my_ai_allowance')
    expect(rpc).toHaveBeenNthCalledWith(3, 'get_my_storage_summary')
    expect(result).toMatchObject({
      storageBytes: 1048576,
      storageCapacityBytes: 209715200,
      storageRemainingBytes: 208666624,
      storagePercent: 0,
      aiRequestLimit: 100,
      aiRequestsRemaining: 96,
      aiTokenLimit: 250000,
      aiTokensUsed: 150,
      aiTokensRemaining: 249850,
      allowancePeriodEnd: '2026-10-01T00:00:00.000Z',
    })
  })

  it('keeps the original Supabase error out of the browser response', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for column idempotency_key' },
    })

    await expect(
      getUsageSummaryFn({ data: { month: '2026-09' } }),
    ).rejects.toThrow('Usage data is unavailable.')
  })
})
