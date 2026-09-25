import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DashboardStorageCard } from '#/features/dashboard/stats-cards'
import type { UsageSummary } from '#/lib/usage/types'
import { UsageSummaryView } from './usage-panel'

const MB = 1024 * 1024

const baseUsage: UsageSummary = {
  month: '2026-09',
  aiRequests: 12,
  inputTokens: 1000,
  outputTokens: 500,
  totalTokens: 1500,
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
  aiRequestsRemaining: 88,
  aiRequestPercent: 12,
  aiTokenLimit: 250000,
  aiTokensUsed: 1500,
  aiTokensRemaining: 248500,
  aiTokenPercent: 0,
  aiAllowancePercent: 12,
  aiAllowanceReached: false,
  featureBreakdown: [],
}

const usage = (overrides: Partial<UsageSummary> = {}): UsageSummary => ({
  ...baseUsage,
  ...overrides,
})

describe('usage UI', () => {
  it('shows authoritative dashboard storage values and an accessible percentage', () => {
    const output = renderToStaticMarkup(
      createElement(DashboardStorageCard, { storage: usage() }),
    )

    expect(output).toContain('17%')
    expect(output).toContain('35 MB')
    expect(output).toContain('200 MB')
    expect(output).toContain('role="progressbar"')
    expect(output).toContain(
      'aria-label="17% of storage used. 35 MB of 200 MB."',
    )
  })

  it('renders the Settings usage metrics as individual responsive cards', () => {
    const output = renderToStaticMarkup(
      createElement(UsageSummaryView, { usage: usage() }),
    )

    expect(output).toContain('September 2026')
    expect(output).toContain('AI requests')
    expect(output).toContain('AI tokens')
    expect(output).toContain('Papers processed')
    expect(output).toContain('Embedding chunks')
    expect(output).toContain('12 of 100 used')
    expect(output).toContain('1.5K of 250K used')
    expect(output).toContain('Resets Oct 1')
    expect(output).toContain('sm:grid-cols-2')
    expect(output).toContain('xl:grid-cols-4')
  })

  it('renders the dedicated storage capacity card', () => {
    const output = renderToStaticMarkup(
      createElement(UsageSummaryView, { usage: usage() }),
    )

    expect(output).toContain('>Storage<')
    expect(output).toContain('35 MB used')
    expect(output).toContain('of 200 MB')
    expect(output).toContain('165 MB available')
  })

  it('shows AI allowance warning and reached states', () => {
    const warning = renderToStaticMarkup(
      createElement(UsageSummaryView, {
        usage: usage({ aiRequests: 80, aiRequestPercent: 80 }),
      }),
    )
    const exhausted = renderToStaticMarkup(
      createElement(UsageSummaryView, {
        usage: usage({
          aiTokensUsed: 250000,
          aiTokensRemaining: 0,
          aiTokenPercent: 100,
          aiAllowancePercent: 100,
          aiAllowanceReached: true,
        }),
      }),
    )

    expect(warning).toContain('Approaching monthly allowance')
    expect(exhausted).toContain('Monthly allowance reached')
    expect(exhausted).toContain('aria-valuenow="100"')
  })

  it('shows a textual warning at 80 percent', () => {
    const output = renderToStaticMarkup(
      createElement(UsageSummaryView, {
        usage: usage({
          storageBytes: 160 * MB,
          storageRemainingBytes: 40 * MB,
          storagePercent: 80,
        }),
      }),
    )

    expect(output).toContain('80%')
    expect(output).toContain('Storage is nearly full')
  })

  it('shows Storage full at 100 percent', () => {
    const output = renderToStaticMarkup(
      createElement(UsageSummaryView, {
        usage: usage({
          storageBytes: 200 * MB,
          storageRemainingBytes: 0,
          storagePercent: 100,
        }),
      }),
    )

    expect(output).toContain('100%')
    expect(output).toContain('Storage full')
  })

  it('renders zero storage without a warning', () => {
    const output = renderToStaticMarkup(
      createElement(UsageSummaryView, {
        usage: usage({
          aiRequests: 0,
          totalTokens: 0,
          papersProcessed: 0,
          embeddingChunks: 0,
          storageBytes: 0,
          storageRemainingBytes: 200 * MB,
          storagePercent: 0,
        }),
      }),
    )

    expect(output).toContain('aria-valuenow="0"')
    expect(output).toContain('0 B used')
    expect(output).not.toContain('Storage is nearly full')
    expect(output).not.toContain('Storage full')
  })

  it('hides an empty feature breakdown and formats real feature usage', () => {
    const empty = renderToStaticMarkup(
      createElement(UsageSummaryView, { usage: usage() }),
    )
    const populated = renderToStaticMarkup(
      createElement(UsageSummaryView, {
        usage: usage({
          featureBreakdown: [
            { feature: 'research_chat', requests: 12 },
            { feature: 'academic_writer', requests: 1 },
          ],
        }),
      }),
    )

    expect(empty).not.toContain('AI usage by feature')
    expect(populated).toContain('AI usage by feature')
    expect(populated).toContain('Research Chat')
    expect(populated).toContain('12 requests')
    expect(populated).toContain('Academic Writer')
    expect(populated).toContain('1 request')
  })
})
