import { describe, expect, it } from 'vitest'
import {
  formatCitationAuthors,
  formatNumericCitationMarkers,
  formatNumericDraftCopy,
  formatNumericReference,
  formatNumericReferenceList,
} from './format'
import type { CitationDraftUsage } from './types'

const paper = (overrides: Record<string, unknown> = {}) => ({
  paperId: 'paper-1',
  title: 'Reliable Research',
  ...overrides,
})

describe('numeric citation formatter', () => {
  it('formats title only without invented metadata', () => {
    expect(formatNumericReference(1, paper())).toBe(
      '[1] “Reliable Research.”',
    )
  })

  it('formats title and year with stable punctuation', () => {
    expect(
      formatNumericReference(2, paper({ publicationYear: 2024 })),
    ).toBe('[2] “Reliable Research,” 2024.')
  })

  it('formats an author and title without inventing a year', () => {
    expect(
      formatNumericReference(3, paper({ authors: ['Ada Lovelace'] })),
    ).toBe('[3] Ada Lovelace, “Reliable Research.”')
  })

  it('preserves multiple authors and their order without parsing names', () => {
    expect(formatCitationAuthors(['A. One', 'B. Two'])).toBe(
      'A. One and B. Two',
    )
    expect(formatCitationAuthors(['A. One', 'B. Two', 'C. Three'])).toBe(
      'A. One, B. Two, and C. Three',
    )
    expect(
      formatNumericReference(
        1,
        paper({ authors: ['Zhang Wei', 'Ana María Ruiz', 'ResearchAI Lab'] }),
      ),
    ).toBe(
      '[1] Zhang Wei, Ana María Ruiz, and ResearchAI Lab, “Reliable Research.”',
    )
  })

  it('supports an organizational author as an ordinary string', () => {
    expect(
      formatNumericReference(
        1,
        paper({ authors: ['World Health Organization'], publicationYear: 2023 }),
      ),
    ).toBe(
      '[1] World Health Organization, “Reliable Research,” 2023.',
    )
  })

  it('formats container, publisher, volume, issue, pages, and year', () => {
    expect(
      formatNumericReference(
        4,
        paper({
          authors: ['A. Author'],
          containerTitle: 'Journal of Tests',
          volume: '12',
          issue: '3',
          pages: '41–49',
          publisher: 'Example Press',
          publicationYear: 2022,
        }),
      ),
    ).toBe(
      '[4] A. Author, “Reliable Research,” Journal of Tests, vol. 12, no. 3, pp. 41–49, Example Press, 2022.',
    )
  })

  it('formats a canonical DOI URL', () => {
    expect(formatNumericReference(1, paper({ doi: 'DOI: 10.1234/ABC' }))).toBe(
      '[1] “Reliable Research.” https://doi.org/10.1234/abc',
    )
  })

  it('formats a safe URL when DOI is unavailable', () => {
    expect(
      formatNumericReference(1, paper({ url: 'https://example.org/paper' })),
    ).toBe('[1] “Reliable Research.” https://example.org/paper')
  })

  it('prefers DOI over URL and omits malformed legacy identifiers', () => {
    expect(
      formatNumericReference(
        1,
        paper({
          doi: '10.1234/primary',
          url: 'https://example.org/secondary',
        }),
      ),
    ).toBe('[1] “Reliable Research.” https://doi.org/10.1234/primary')
    expect(
      formatNumericReference(
        1,
        paper({ doi: 'invalid', url: 'javascript:alert(1)' }),
      ),
    ).toBe('[1] “Reliable Research.”')
  })

  it('does not infer a reference from an original filename', () => {
    expect(
      formatNumericReference(1, {
        paperId: 'paper-1',
        title: '',
        original_filename: 'secret-title.pdf',
      } as never),
    ).toBe('[1]')
  })

  it('never produces doubled punctuation or whitespace', () => {
    const formatted = formatNumericReference(
      1,
      paper({
        authors: ['A. Author'],
        containerTitle: 'A Venue',
        publicationYear: 2020,
      }),
    )
    expect(formatted).not.toMatch(/,,|\.\.| {2}/)
    expect(formatted).toBe(
      '[1] A. Author, “Reliable Research,” A Venue, 2020.',
    )
  })
})

describe('reference and copy primitives', () => {
  const draft: CitationDraftUsage = {
    paragraphs: [
      {
        units: [
          { text: 'First claim.', citationIds: ['W2', 'W1'] },
          { text: 'Second claim.', citationIds: ['W3'] },
        ],
      },
    ],
    citations: [
      { id: 'W1', paperId: 'paper-a' },
      { id: 'W2', paperId: 'paper-a' },
      { id: 'W3', paperId: 'paper-b' },
    ],
  }

  it('formats markers and a cited-only reference list', () => {
    expect(formatNumericCitationMarkers([1, 2])).toBe('[1] [2]')
    expect(
      formatNumericReferenceList(
        [
          { paperId: 'paper-a', number: 1, evidenceIds: ['W2', 'W1'] },
          { paperId: 'paper-b', number: 2, evidenceIds: ['W3'] },
        ],
        [
          { paperId: 'paper-a', title: 'Paper A' },
          { paperId: 'paper-b', title: 'Paper B' },
          { paperId: 'uncited', title: 'Never shown' },
        ],
      ),
    ).toBe('[1] “Paper A.”\n[2] “Paper B.”')
  })

  it('formats draft text with paper-level markers and References', () => {
    expect(
      formatNumericDraftCopy(draft, [
        { paperId: 'paper-a', title: 'Paper A' },
        { paperId: 'paper-b', title: 'Paper B' },
      ]),
    ).toBe(
      'First claim. [1] Second claim. [2]\n\nReferences\n\n[1] “Paper A.”\n[2] “Paper B.”',
    )
  })

  it('omits the References heading when a draft has no citations', () => {
    expect(
      formatNumericDraftCopy(
        {
          paragraphs: [{ units: [{ text: 'Uncited.', citationIds: [] }] }],
          citations: [],
        },
        [],
      ),
    ).toBe('Uncited.')
  })
})
