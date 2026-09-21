import { describe, expect, it } from 'vitest'
import {
  assessCitationMetadataCompleteness,
  citationDoiUrl,
  normalizeCitationDoi,
  normalizeCitationUrl,
  normalizePaperCitationMetadata,
} from './normalize'
import {
  CITATION_METADATA_LIMITS,
  CITATION_PUBLICATION_YEAR_MAX,
} from './types'

const base = { paperId: 'paper-1', title: 'A paper' }

describe('citation metadata normalization', () => {
  it('normalizes Unicode, whitespace, controls, bidi, and format characters', () => {
    const result = normalizePaperCitationMetadata({
      ...base,
      title: '  Fullwidth：\tTitle\n Here\u0000\u202e\u200b  ',
      containerTitle: ' Journal   of\nResearch ',
    })
    expect(result.title).toBe('Fullwidth: Title Here')
    expect(result.containerTitle).toBe('Journal of Research')
    expect(result.title).not.toMatch(/[\p{Cc}\p{Cf}]/u)
  })

  it('bounds text fields without inferring missing values', () => {
    const result = normalizePaperCitationMetadata({
      ...base,
      title: 't'.repeat(800),
      containerTitle: 'c'.repeat(800),
      publisher: 'p'.repeat(500),
      volume: 'v'.repeat(100),
      issue: 'i'.repeat(100),
      pages: 'g'.repeat(200),
    })
    expect(result.title).toHaveLength(CITATION_METADATA_LIMITS.title)
    expect(result.containerTitle).toHaveLength(
      CITATION_METADATA_LIMITS.containerTitle,
    )
    expect(result.publisher).toHaveLength(CITATION_METADATA_LIMITS.publisher)
    expect(result.volume).toHaveLength(CITATION_METADATA_LIMITS.volume)
    expect(result.issue).toHaveLength(CITATION_METADATA_LIMITS.issue)
    expect(result.pages).toHaveLength(CITATION_METADATA_LIMITS.pages)
    expect(result.authors).toEqual([])
    expect(result.publicationYear).toBeNull()
  })

  it('bounds author count and length while preserving order and spelling', () => {
    const authors = Array.from(
      { length: CITATION_METADATA_LIMITS.authors + 5 },
      (_, index) => `  Organization ${index} ${'x'.repeat(250)}  `,
    )
    const result = normalizePaperCitationMetadata({ ...base, authors })
    expect(result.authors).toHaveLength(CITATION_METADATA_LIMITS.authors)
    expect(result.authors[0]).toMatch(/^Organization 0 /)
    expect(result.authors[0]).toHaveLength(CITATION_METADATA_LIMITS.author)
    expect(result.authors[1]).toMatch(/^Organization 1 /)
  })

  it.each([
    [999, null],
    [1000, 1000],
    [2026, 2026],
    [CITATION_PUBLICATION_YEAR_MAX, CITATION_PUBLICATION_YEAR_MAX],
    [CITATION_PUBLICATION_YEAR_MAX + 1, null],
    [2024.5, null],
  ])('normalizes publication year %s to %s', (year, expected) => {
    expect(
      normalizePaperCitationMetadata({ ...base, publicationYear: year })
        .publicationYear,
    ).toBe(expected)
  })

  it.each([
    ['10.1000/ABC.Def', '10.1000/abc.def'],
    ['doi: 10.5555/Test-1', '10.5555/test-1'],
    ['https://doi.org/10.1234/Thing(2)', '10.1234/thing(2)'],
    ['http://dx.doi.org/10.9876/A:B', '10.9876/a:b'],
  ])('canonicalizes DOI %s', (value, expected) => {
    expect(normalizeCitationDoi(value)).toBe(expected)
    expect(citationDoiUrl(value)).toBe(`https://doi.org/${expected}`)
  })

  it.each([
    '',
    'not-a-doi',
    '10.1/too-short-prefix',
    '10.1234',
    '10.1234/has whitespace',
    'https://example.com/10.1234/value',
  ])('rejects malformed DOI %s', (value) => {
    expect(normalizeCitationDoi(value)).toBeNull()
    expect(citationDoiUrl(value)).toBeNull()
  })

  it('accepts only credential-free HTTP(S) URLs', () => {
    expect(normalizeCitationUrl(' https://example.org/paper?id=1 ')).toBe(
      'https://example.org/paper?id=1',
    )
    expect(normalizeCitationUrl('http://example.org/paper')).toBe(
      'http://example.org/paper',
    )
    expect(normalizeCitationUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeCitationUrl('data:text/html,test')).toBeNull()
    expect(normalizeCitationUrl('ftp://example.org/paper')).toBeNull()
    expect(normalizeCitationUrl('https://user:pass@example.org')).toBeNull()
    expect(normalizeCitationUrl('not a url')).toBeNull()
  })
})

describe('citation metadata completeness', () => {
  it('is complete enough with title, author, and valid year', () => {
    expect(
      assessCitationMetadataCompleteness({
        ...base,
        authors: ['Research Organization'],
        publicationYear: 2025,
      }),
    ).toEqual({ status: 'complete_enough', missingImportantFields: [] })
  })

  it('reports title-only metadata deterministically without blocking it', () => {
    expect(assessCitationMetadataCompleteness(base)).toEqual({
      status: 'incomplete',
      missingImportantFields: ['authors', 'publicationYear'],
    })
  })

  it('reports every missing important field in stable field order', () => {
    expect(
      assessCitationMetadataCompleteness({ paperId: 'paper-1', title: ' ' }),
    ).toEqual({
      status: 'incomplete',
      missingImportantFields: ['title', 'authors', 'publicationYear'],
    })
  })
})
