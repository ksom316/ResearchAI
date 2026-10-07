import { describe, expect, it } from 'vitest'
import { classifyDocument } from './classifier'
import type { DocumentSection } from './types'

const section = (title: string): DocumentSection => ({
  position: 0,
  title,
  sectionType: 'other',
  text: '',
  charStart: 0,
  pageStart: 1,
  pageEnd: 1,
})

describe('classifyDocument', () => {
  it('classifies a financial statement', () => {
    const result = classifyDocument(
      'Consolidated Statements of Income for the fiscal year ended. Total assets increased.',
      [],
    )
    expect(result.documentType).toBe('financial')
    expect(result.method).toBe('deterministic')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('classifies an academic paper from structure', () => {
    const result = classifyDocument('Some prose with a DOI: 10.1234/example.2024', [
      section('Abstract'),
      section('Introduction'),
      section('Related Work'),
      section('Methodology'),
      section('Conclusion'),
    ])
    expect(result.documentType).toBe('academic')
  })

  it('classifies a thesis', () => {
    const result = classifyDocument(
      'A thesis submitted in partial fulfillment of the requirements for the degree of Doctor of Philosophy.',
      [],
    )
    expect(result.documentType).toBe('thesis')
  })

  it('returns unknown/general_report rather than guessing on weak signal text', () => {
    const result = classifyDocument('The quick brown fox jumps over the lazy dog.', [])
    expect(['unknown', 'general_report']).toContain(result.documentType)
    expect(result.confidence).toBeLessThan(0.5)
  })

  it('returns an empty document as general_report with zero confidence', () => {
    const result = classifyDocument('', [])
    expect(result).toEqual({
      documentType: 'general_report',
      confidence: 0,
      method: 'deterministic',
    })
  })
})
