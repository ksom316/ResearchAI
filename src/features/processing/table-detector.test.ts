import { describe, expect, it } from 'vitest'
import { detectTables } from './table-detector'
import type { ExtractedDocument } from './types'

function doc(pages: string[]): ExtractedDocument {
  return {
    pageCount: pages.length,
    pages: pages.map((text, i) => ({ pageNumber: i + 1, text })),
  }
}

describe('detectTables', () => {
  it('detects a simple aligned table with a caption', () => {
    const page = [
      'Table 1: Revenue by region',
      'Region\tQ1\tQ2',
      'North\t100\t110',
      'South\t90\t95',
      'East\t80\t85',
    ].join('\n')

    const tables = detectTables(doc([page]))
    expect(tables).toHaveLength(1)
    const [table] = tables
    expect(table.caption).toBe('Table 1: Revenue by region')
    expect(table.headers).toEqual(['Region', 'Q1', 'Q2'])
    expect(table.rows).toEqual([
      ['North', '100', '110'],
      ['South', '90', '95'],
      ['East', '80', '85'],
    ])
    expect(table.pageStart).toBe(1)
    expect(table.pageEnd).toBe(1)
    expect(table.confidence).toBe(1)
  })

  it('ignores short runs below the minimum row count', () => {
    const page = ['A\tB', 'C\tD'].join('\n')
    expect(detectTables(doc([page]))).toHaveLength(0)
  })

  it('ignores ordinary prose with no tab-separated columns', () => {
    const page = 'This is a normal paragraph.\nIt has multiple lines.\nBut no tables.'
    expect(detectTables(doc([page]))).toHaveLength(0)
  })

  it('assigns increasing tableIndex across pages', () => {
    const table = ['H1\tH2', 'a\tb', 'c\td', 'e\tf'].join('\n')
    const tables = detectTables(doc([table, table]))
    expect(tables.map((t) => t.tableIndex)).toEqual([0, 1])
    expect(tables.map((t) => t.pageStart)).toEqual([1, 2])
  })

  it('reports reduced confidence when column counts are inconsistent', () => {
    const page = ['H1\tH2\tH3', 'a\tb\tc', 'd\te', 'f\tg\th'].join('\n')
    const tables = detectTables(doc([page]))
    expect(tables).toHaveLength(1)
    expect(tables[0].confidence).toBeLessThan(1)
  })
})
