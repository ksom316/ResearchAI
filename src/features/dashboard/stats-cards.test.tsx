import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { UsageSummary } from '#/lib/usage/types'
import { DashboardAiAllowanceCard, DashboardResourceCards } from './stats-cards'

const MB = 1024 * 1024

const usage = (overrides: Partial<UsageSummary> = {}): UsageSummary => ({
  month: '2026-09',
  aiRequests: 23,
  inputTokens: 40000,
  outputTokens: 18000,
  totalTokens: 58000,
  papersProcessed: 3,
  paperPages: 42,
  embeddingChunks: 84,
  embeddingRequests: 2,
  embeddingTokens: 2400,
  storageBytes: 35 * MB,
  storageCapacityBytes: 200 * MB,
  storageRemainingBytes: 165 * MB,
  storagePercent: 17,
  allowancePeriodStart: '2026-09-01T00:00:00.000Z',
  allowancePeriodEnd: '2026-10-01T00:00:00.000Z',
  aiRequestLimit: 100,
  aiRequestsRemaining: 77,
  aiRequestPercent: 23,
  aiTokenLimit: 250000,
  aiTokensUsed: 58000,
  aiTokensRemaining: 192000,
  aiTokenPercent: 23,
  aiAllowancePercent: 23,
  aiAllowanceReached: false,
  featureBreakdown: [],
  ...overrides,
})

describe('dashboard resource cards', () => {
  it('shows compact request and token allowances with the reset date', () => {
    const output = renderToStaticMarkup(
      createElement(DashboardAiAllowanceCard, { usage: usage() }),
    )

    expect(output).toContain('AI usage')
    expect(output).toContain('23 / 100')
    expect(output).toContain('58K / 250K')
    expect(output).toContain('Resets Oct 1')
    expect(output).toContain(
      'aria-label="AI requests: 23 of 100 used. Resets Oct 1."',
    )
    expect(output).toContain('aria-valuenow="23"')
  })

  it('shows a textual warning at 80 percent', () => {
    const output = renderToStaticMarkup(
      createElement(DashboardAiAllowanceCard, {
        usage: usage({
          aiRequests: 80,
          aiRequestsRemaining: 20,
          aiRequestPercent: 80,
          aiAllowancePercent: 80,
        }),
      }),
    )

    expect(output).toContain('Approaching monthly allowance')
    expect(output).toContain('bg-amber-500')
  })

  it('clearly identifies an exhausted allowance', () => {
    const output = renderToStaticMarkup(
      createElement(DashboardAiAllowanceCard, {
        usage: usage({
          aiRequests: 100,
          aiRequestsRemaining: 0,
          aiRequestPercent: 100,
          aiAllowancePercent: 100,
          aiAllowanceReached: true,
        }),
      }),
    )

    expect(output).toContain('Monthly allowance reached')
    expect(output).toContain('text-destructive')
    expect(output).toContain('aria-valuenow="100"')
  })

  it('uses a compact loading state', () => {
    const output = renderToStaticMarkup(
      createElement(DashboardAiAllowanceCard, { isLoading: true }),
    )

    expect(output).toContain('aria-label="Loading AI usage"')
    expect(output).not.toContain('temporarily unavailable')
  })

  it('uses a quiet fallback when usage is unavailable', () => {
    const output = renderToStaticMarkup(createElement(DashboardAiAllowanceCard))

    expect(output).toContain('AI usage is temporarily unavailable.')
    expect(output).not.toContain('role="alert"')
  })

  it('preserves the authoritative storage visualization and values', () => {
    const output = renderToStaticMarkup(
      createElement(DashboardResourceCards, { usage: usage() }),
    )

    expect(output).toContain(
      'aria-label="17% of storage used. 35 MB of 200 MB."',
    )
    expect(output).toContain('35 MB')
    expect(output).toContain('200 MB')
  })

  it('stacks on mobile and pairs resource cards from tablet widths', () => {
    const output = renderToStaticMarkup(
      createElement(DashboardResourceCards, { usage: usage() }),
    )

    expect(output).toContain('grid-cols-1')
    expect(output).toContain('md:grid-cols-2')
    expect(output).toContain('min-w-0')
    expect(output).toContain('flex-wrap')
    expect(output).toContain('whitespace-nowrap')
  })
})
