import { describe, expect, it } from 'vitest'
import { buildPersistenceRows, processingSucceededUpdate } from './persistence'
import { processExtractedDocument } from './pipeline'
import type { ExtractedDocument } from './types'

/**
 * R12: end-to-end checks that document profiling, classification, table
 * detection and fact extraction survive all the way into persistence rows -
 * i.e. that a table/fact detected by the pure pipeline actually becomes a
 * retrievable chunk with correct provenance, not just an in-memory value.
 */

const financialDoc: ExtractedDocument = {
  pageCount: 1,
  pages: [
    {
      pageNumber: 1,
      text: [
        'Annual Report',
        '',
        'Consolidated Statements of Income',
        '',
        'Total revenue for FY2025 was $12.4 million, up from the prior year.',
        '',
        'Table 1: Quarterly results',
        'Quarter\tRevenue\tNet income',
        'Q1\t2.9\t0.4',
        'Q2\t3.0\t0.5',
        'Q3\t3.1\t0.4',
        'Q4\t3.4\t0.6',
      ].join('\n'),
    },
  ],
}

const mixedScannedDoc: ExtractedDocument = {
  pageCount: 3,
  pages: [
    { pageNumber: 1, text: 'Introduction\nThis page has normal text content on it, plenty of it.' },
    { pageNumber: 2, text: '' }, // scanned image page, no text layer
    { pageNumber: 3, text: 'Conclusion\nMore ordinary digital text content here as well.' },
  ],
}

describe('R12 document intelligence pipeline', () => {
  it('classifies a financial document and marks extraction successful', () => {
    const result = processExtractedDocument(financialDoc)
    expect(result.classification.documentType).toBe('financial')
    expect(result.extractionQuality).toBe('successful')
  })

  it('detects the table and attaches page-level provenance', () => {
    const result = processExtractedDocument(financialDoc)
    expect(result.tables).toHaveLength(1)
    expect(result.tables[0].caption).toBe('Table 1: Quarterly results')
    expect(result.tables[0].pageStart).toBe(1)
    expect(result.tables[0].headers).toEqual(['Quarter', 'Revenue', 'Net income'])
  })

  it('extracts the revenue fact from prose with page provenance', () => {
    const result = processExtractedDocument(financialDoc)
    const revenue = result.facts.find((f) => f.metric === 'revenue' && f.tableIndex === null)
    expect(revenue?.value).toBe(12.4e6)
    expect(revenue?.pageNumber).toBe(1)
  })

  it('persists tables and facts as searchable chunks with provenance, alongside prose chunks', () => {
    const document = processExtractedDocument(financialDoc)
    let n = 0
    const rows = buildPersistenceRows(
      { paperId: 'paper-1', userId: 'user-1' },
      document,
      () => `id-${n++}`,
    )

    expect(rows.tables).toHaveLength(1)
    expect(rows.tables[0].headers).toEqual(['Quarter', 'Revenue', 'Net income'])

    const tableChunk = rows.chunks.find((c) => c.source_kind === 'table')
    expect(tableChunk).toBeDefined()
    expect(tableChunk?.text).toContain('Quarterly results')
    expect(tableChunk?.page_start).toBe(1)

    const factChunk = rows.chunks.find((c) => c.source_kind === 'fact')
    expect(factChunk).toBeDefined()
    expect(factChunk?.text).toContain('revenue')

    // Every chunk still has a paper/user/section it belongs to - no row is
    // detached from its owning document.
    for (const chunk of rows.chunks) {
      expect(chunk.paper_id).toBe('paper-1')
      expect(chunk.user_id).toBe('user-1')
      expect(chunk.section_id).toBeTruthy()
    }
    for (const table of rows.tables) {
      expect(table.paper_id).toBe('paper-1')
    }
    for (const fact of rows.facts) {
      expect(fact.paper_id).toBe('paper-1')
    }
    // The net_income fact came from inside the table, so it is linked back to it.
    const netIncomeFact = rows.facts.find((f) => f.metric === 'net_income')
    expect(netIncomeFact?.table_id).toBe(rows.tables[0].id)
  })

  it('links a table-sourced fact to the persisted table row id', () => {
    const document = processExtractedDocument(financialDoc)
    const rows = buildPersistenceRows({ paperId: 'p', userId: 'u' }, document)
    const tableFact = document.facts.find((f) => f.tableIndex !== null)
    expect(tableFact).toBeDefined()
    const persistedFact = rows.facts.find((f) => f.metric === tableFact!.metric && f.value === tableFact!.value)
    expect(persistedFact?.table_id).toBe(rows.tables[0].id)
  })

  it('reports partial extraction quality for a mixed digital/scanned document', () => {
    const result = processExtractedDocument(mixedScannedDoc)
    expect(result.extractionQuality).toBe('partial')
    expect(result.pages.find((p) => p.pageNumber === 2)?.likelyScanned).toBe(true)
  })

  it('carries classification and extraction quality into the papers update', () => {
    const document = processExtractedDocument(financialDoc)
    const update = processingSucceededUpdate(document)
    expect(update.document_type).toBe('financial')
    expect(update.extraction_quality).toBe('successful')
    expect(update.document_type_method).toBe('deterministic')
  })

  it('is idempotent: reprocessing the same document yields the same facts and tables', () => {
    const first = processExtractedDocument(financialDoc)
    const second = processExtractedDocument(financialDoc)
    expect(second.tables).toEqual(first.tables)
    expect(second.facts).toEqual(first.facts)
  })
})
