import { describe, expect, it } from 'vitest'
import { extractFactsFromTables, extractFactsFromText } from './fact-extractor'
import { normalizeDocument } from './normalize'
import type { DetectedTable, ExtractedDocument } from './types'

function normalized(pages: string[]) {
  const doc: ExtractedDocument = {
    pageCount: pages.length,
    pages: pages.map((text, i) => ({ pageNumber: i + 1, text })),
  }
  return normalizeDocument(doc)
}

describe('extractFactsFromText', () => {
  it('extracts a revenue figure with currency, scale and period, mapped to its page', () => {
    const doc = normalized(['Intro page.', 'Total revenue for FY2025 was $12.4 million.'])
    const facts = extractFactsFromText(doc)
    const revenue = facts.find((f) => f.metric === 'revenue')
    expect(revenue).toBeDefined()
    expect(revenue?.value).toBe(12.4e6)
    expect(revenue?.currency).toBe('USD')
    expect(revenue?.period).toBe('FY2025')
    expect(revenue?.pageNumber).toBe(2)
    expect(revenue?.tableIndex).toBeNull()
  })

  it('extracts a percent margin', () => {
    const doc = normalized(['Net margin was 18.2% in 2024.'])
    const facts = extractFactsFromText(doc)
    const margin = facts.find((f) => f.metric === 'net_margin')
    expect(margin?.value).toBe(18.2)
    expect(margin?.unit).toBe('percent')
  })

  it('does not fabricate a fact when a metric label has no nearby number', () => {
    const doc = normalized(['Revenue grew strongly this year without a specific figure here.'])
    const facts = extractFactsFromText(doc)
    expect(facts.find((f) => f.metric === 'revenue' && f.value !== null)).toBeUndefined()
  })

  it('keeps the original text for human verification', () => {
    const doc = normalized(['Total assets were $500,000 as of year end.'])
    const [fact] = extractFactsFromText(doc)
    expect(fact.rawText).toContain('Total assets')
  })
})

describe('extractFactsFromTables', () => {
  it('extracts facts from table rows with table provenance', () => {
    const tables: DetectedTable[] = [
      {
        tableIndex: 0,
        pageStart: 5,
        pageEnd: 5,
        caption: 'Table 2: Key metrics',
        headers: ['Metric', 'Value'],
        rows: [['Net income', '$3.1 million']],
        confidence: 1,
      },
    ]
    const facts = extractFactsFromTables(tables)
    expect(facts).toHaveLength(1)
    expect(facts[0].metric).toBe('net_income')
    expect(facts[0].value).toBe(3.1e6)
    expect(facts[0].pageNumber).toBe(5)
    expect(facts[0].tableIndex).toBe(0)
  })
})
