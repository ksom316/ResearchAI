import { describe, expect, it } from 'vitest'
import type {
  NormalizedWriterRequest,
  WriterEvidenceCoverage,
  WriterEvidenceItem,
  WriterEvidencePacket,
} from './types'
import { validateWriterDraft } from './validate-draft'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

const evidenceItem = (
  number: number,
  paperId: string,
  itemIndex: number,
): WriterEvidenceItem => ({
  id: `W${number}`,
  locator: {
    kind: 'extraction_claim',
    paperId,
    schemaVersion: 1,
    fieldKey: 'findings',
    itemIndex,
  },
  paperId,
  paperTitle: paperId === P1 ? 'Alpha' : 'Beta',
  claimText: `Claim ${number}`,
  sourceRecords: [
    {
      chunkId: `chunk-${number}`,
      sectionId: `section-${number}`,
      sectionTitle: 'Results',
      sectionType: 'results',
      pageStart: number,
      pageEnd: number,
      excerpt: `Excerpt ${number}`,
      content: `Content ${number}`,
    },
  ],
  promptText: `Claim: Claim ${number}\nSource 1: Content ${number}`,
  isStale: false,
})

const evidence: WriterEvidencePacket = {
  items: [
    evidenceItem(1, P1, 0),
    evidenceItem(2, P1, 1),
    evidenceItem(3, P2, 0),
  ],
  paperIds: [P1, P2],
  totalPromptChars: 120,
}
const request: NormalizedWriterRequest = {
  projectId: '33333333-3333-4333-8333-333333333333',
  mode: 'findings_synthesis',
}
const coverage: WriterEvidenceCoverage = {
  projectPaperCount: 2,
  selectedPaperCount: 2,
  participatingPaperCount: 2,
  unavailablePaperCount: 0,
  evidenceItemCount: 3,
}
const input = { request, evidence, coverage }
const generated = (paragraphs: unknown[]) => ({
  status: 'generated',
  paragraphs,
})
const unit = (text: string, citationIds: string[]) => ({
  text,
  citation_ids: citationIds,
})

describe('fail-closed Writer draft validation', () => {
  it('normalizes a valid one-citation unit with server-owned identity and title', () => {
    const result = validateWriterDraft(
      generated([{ units: [unit('A supported finding.', ['W1'])] }]),
      input,
    )
    expect(result).toEqual({
      ok: true,
      status: 'generated',
      draft: {
        title: 'Findings synthesis',
        mode: 'findings_synthesis',
        paragraphs: [
          {
            units: [
              {
                id: 'U1',
                text: 'A supported finding.',
                citationIds: ['W1'],
              },
            ],
          },
        ],
        citations: [
          {
            id: 'W1',
            paperId: P1,
            paperTitle: 'Alpha',
            locator: evidence.items[0].locator,
            sources: [
              {
                sectionTitle: 'Results',
                sectionType: 'results',
                pageStart: 1,
                pageEnd: 1,
              },
            ],
          },
        ],
        coverage,
      },
    })
  })

  it('normalizes citations into packet order and metadata into first-use order', () => {
    const result = validateWriterDraft(
      generated([
        {
          units: [unit('First.', ['W2', 'W1']), unit('Second.', ['W3', 'W2'])],
        },
      ]),
      input,
    )
    expect(result.ok && result.status).toBe('generated')
    if (result.ok && result.status === 'generated') {
      expect(result.draft.paragraphs[0].units[0].citationIds).toEqual([
        'W1',
        'W2',
      ])
      expect(result.draft.paragraphs[0].units[1].citationIds).toEqual([
        'W2',
        'W3',
      ])
      expect(result.draft.citations.map((citation) => citation.id)).toEqual([
        'W1',
        'W2',
        'W3',
      ])
    }
  })

  it('preserves paragraph structure and assigns U ids across paragraphs', () => {
    const result = validateWriterDraft(
      generated([
        { units: [unit('One.', ['W1']), unit('Two.', ['W2'])] },
        { units: [unit('Three.', ['W3'])] },
      ]),
      input,
    )
    expect(result.ok && result.status).toBe('generated')
    if (result.ok && result.status === 'generated') {
      expect(result.draft.paragraphs).toHaveLength(2)
      expect(
        result.draft.paragraphs.flatMap((paragraph) =>
          paragraph.units.map((value) => value.id),
        ),
      ).toEqual(['U1', 'U2', 'U3'])
    }
  })

  it('returns only cited metadata and keeps same-paper evidence distinct', () => {
    const result = validateWriterDraft(
      generated([{ units: [unit('Two claims.', ['W1', 'W2'])] }]),
      input,
    )
    expect(result.ok && result.status).toBe('generated')
    if (result.ok && result.status === 'generated') {
      expect(result.draft.citations.map((citation) => citation.id)).toEqual([
        'W1',
        'W2',
      ])
      expect(
        new Set(result.draft.citations.map((citation) => citation.paperId)),
      ).toEqual(new Set([P1]))
      expect(result.draft.citations[0].locator).not.toEqual(
        result.draft.citations[1].locator,
      )
      expect(result.draft.citations[0]).not.toHaveProperty('content')
      expect(result.draft.citations[0]).not.toHaveProperty('excerpt')
    }
  })

  it.each([
    ['unknown citation', unit('Claim.', ['W99'])],
    ['uncited unit', unit('Claim.', [])],
    ['duplicate citation', unit('Claim.', ['W1', 'W1'])],
    ['malformed citation', unit('Claim.', ['S1'])],
  ])('rejects the entire draft for an %s', (_name, invalidUnit) => {
    const result = validateWriterDraft(
      generated([{ units: [unit('Otherwise valid.', ['W1']), invalidUnit] }]),
      input,
    )
    expect(result).toEqual({ ok: false, error: 'invalid_citation' })
  })

  it.each([
    ['missing text', { citation_ids: ['W1'] }],
    ['blank text', unit('   ', ['W1'])],
    ['citation marker in text', unit('A claim [W1].', ['W1'])],
    ['numeric citation marker in text', unit('A claim [1].', ['W1'])],
    ['overlong text', unit('x'.repeat(451), ['W1'])],
  ])(
    'rejects the entire draft for invalid content: %s',
    (_name, invalidUnit) => {
      expect(
        validateWriterDraft(
          generated([
            { units: [unit('Otherwise valid.', ['W1']), invalidUnit] },
          ]),
          input,
        ),
      ).toEqual({ ok: false, error: 'invalid_content' })
    },
  )

  it.each([
    ['zero paragraphs', generated([])],
    ['zero units', generated([{ units: [] }])],
    [
      'extra unit field',
      generated([
        { units: [{ ...unit('Claim.', ['W1']), unsupported: true }] },
      ]),
    ],
  ])('rejects structurally invalid generated output: %s', (_name, value) => {
    expect(validateWriterDraft(value, input)).toEqual({
      ok: false,
      error: 'invalid_output',
    })
  })

  it('accepts only a structurally empty provider abstention', () => {
    expect(
      validateWriterDraft(
        { status: 'insufficient_evidence', paragraphs: [] },
        input,
      ),
    ).toEqual({ ok: true, status: 'insufficient_evidence' })
    expect(
      validateWriterDraft(
        {
          status: 'insufficient_evidence',
          paragraphs: [{ units: [unit('Model explanation.', ['W1'])] }],
        },
        input,
      ),
    ).toEqual({ ok: false, error: 'invalid_output' })
  })

  it('rejects a packet whose W mapping no longer matches its authorized locator', () => {
    const corrupt: WriterEvidencePacket = {
      ...evidence,
      items: [
        {
          ...evidence.items[0],
          locator: { ...evidence.items[0].locator, paperId: P2 },
        },
        ...evidence.items.slice(1),
      ],
    }
    expect(
      validateWriterDraft(generated([{ units: [unit('Claim.', ['W1'])] }]), {
        ...input,
        evidence: corrupt,
      }),
    ).toEqual({ ok: false, error: 'invalid_citation' })
  })
})
