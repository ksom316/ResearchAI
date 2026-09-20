import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deriveResearchMap } from '#/features/research-map/derive'
import type {
  ExtractionField,
  FieldKey,
} from '#/features/evidence-matrix/types'
import { deriveResearchGaps } from './derive'
import { statementKey } from './normalize'
import type { DeriveGapsInput } from './types'

const limitation =
  'Spectral graph convolution is limited to static adjacency matrices.'
const future =
  'Evaluate spectral graph convolution on dynamic adjacency matrices.'
const field = (
  paperId: string,
  fieldKey: FieldKey,
  texts: string[],
  overrides: Partial<ExtractionField> = {},
): ExtractionField => ({
  paperId,
  fieldKey,
  schemaVersion: 1,
  state: 'extracted',
  items: texts.map((text) => ({ text })),
  itemsMalformed: false,
  createdAt: 'a',
  updatedAt: 'b',
  ...overrides,
})
function fixture(
  fieldKey: FieldKey = 'limitations',
  text = limitation,
): DeriveGapsInput {
  const fields = [
    ...['a', 'b'].map((id) =>
      field(id, 'concepts', ['Spectral graph convolution']),
    ),
    ...['a', 'b', 'c'].map((id) => field(id, fieldKey, [text])),
  ]
  return {
    fields,
    researchMap: deriveResearchMap({
      papers: ['a', 'b', 'c'].map((id) => ({ id, title: id, status: 'ready' })),
      fields,
      overviews: [],
    }),
  }
}

describe('conservative corpus gap foundation', () => {
  it('keeps independent relationship groups separate, without transitive bridging', () => {
    const text =
      'Spectral graph convolution and temporal graph convolution are limited to static adjacency matrices.'
    const fields = [
      field('a', 'concepts', ['Spectral graph convolution']),
      field('b', 'concepts', [
        'Spectral graph convolution',
        'Temporal graph convolution',
      ]),
      field('c', 'concepts', ['Temporal graph convolution']),
      ...['a', 'b', 'c'].map((id) => field(id, 'limitations', [text])),
    ]
    const researchMap = deriveResearchMap({
      fields,
      overviews: [],
      papers: ['a', 'b', 'c'].map((id) => ({ id, title: id, status: 'ready' })),
    })
    // The map also legitimately shares the shorter "graph convolution" across all
    // three. Remove that relationship to test a graph with only A-B and B-C links.
    researchMap.nodes = researchMap.nodes.filter(
      (node) => node.type !== 'term' || node.key !== 'graph convolution',
    )
    const candidates = deriveResearchGaps({ fields, researchMap })
    expect(candidates.map((candidate) => candidate.paperIds)).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ])
  })

  it('merges redundant relationship anchors and sorts their signals', () => {
    const input = fixture()
    const term = input.researchMap.nodes.find((node) => node.type === 'term')!
    input.researchMap.nodes = [
      ...input.researchMap.nodes,
      { ...term, id: 'term:concept:alternate' },
    ]
    input.researchMap.edges = [
      ...input.researchMap.edges,
      ...input.researchMap.edges.map((edge) => ({
        ...edge,
        id: `${edge.id}:alternate`,
        to: 'term:concept:alternate',
      })),
    ]
    const candidates = deriveResearchGaps(input)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].relatedTermIds).toEqual([
      'term:concept:alternate',
      'term:concept:spectral graph convolution',
    ])
    expect(candidates[0].evidenceCount).toBe(2)
  })

  it.each([
    'Spectral graph convolution is not limited to static adjacency matrices.',
    'Spectral graph convolution is limited to training data.',
  ])(
    'abstains for negated or insufficiently specific statements: %s',
    (text) => {
      expect(deriveResearchGaps(fixture('limitations', text))).toEqual([])
    },
  )

  it('does not mutate loaded input', () => {
    const input = fixture()
    const snapshot = JSON.stringify(input)
    deriveResearchGaps(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('keeps the engine free of network, providers, clock, randomness and source loading', () => {
    for (const file of [
      'derive',
      'normalize',
      'signals',
      'signatures',
      'types',
      'vocabulary',
    ]) {
      const source = readFileSync(
        `src/features/research-gaps/${file}.ts`,
        'utf8',
      )
        .replace(/\/\*[^]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
      expect(source).not.toMatch(
        /supabase|openrouter|voyage|fetch\(|Date\b|Math\.random|ExtractionSource|worker|process\.env/u,
      )
      expect(source).not.toMatch(
        /evidence-matrix\/(api|queries|extract|schema|prompt)/u,
      )
    }
  })
  it('derives a recurring limitation with exact, lazy-loadable provenance', () => {
    const result = deriveResearchGaps(fixture())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'recurring_limitation',
      paperIds: ['a', 'b'],
      supportCount: 2,
      evidenceCount: 2,
      isStale: false,
      relatedTermIds: ['term:concept:spectral graph convolution'],
      evidenceRefs: ['a', 'b'].map((paperId) => ({
        paperId,
        fieldKey: 'limitations',
        itemIndex: 0,
        matchedPhrase: null,
      })),
      signals: [
        {
          type: 'matching_explicit_statements',
          fieldKey: 'limitations',
          statementKey: statementKey(limitation),
        },
        {
          type: 'shared_map_term',
          termId: 'term:concept:spectral graph convolution',
        },
      ],
    })
    expect(result[0].title).toContain('in this corpus')
    expect(result[0].description).toContain('potential gap in this corpus')
  })

  it('requires a direct relationship and excludes an unrelated third paper', () => {
    const input = fixture()
    expect(deriveResearchGaps(input)[0].paperIds).toEqual(['a', 'b'])
    input.researchMap.edges = []
    expect(deriveResearchGaps(input)).toEqual([])
  })

  it('derives multi-paper future work, but rejects single-paper support', () => {
    const input = fixture('future_work', future)
    expect(deriveResearchGaps(input)[0].type).toBe(
      'future_research_opportunity',
    )
    input.fields = input.fields.filter((row) => row.paperId !== 'b')
    expect(deriveResearchGaps(input)).toEqual([])
  })

  it.each([
    'More research is needed to improve the model.',
    'Spectral graph convolution requires further research.',
    'Spectral graph convolution is limited and requires further research.',
    'The model is limited to training data.',
  ])('rejects generic statements: %s', (text) => {
    expect(deriveResearchGaps(fixture('limitations', text))).toEqual([])
  })

  it('does not match statements from generic lexical overlap or opposite assertions', () => {
    const input = fixture()
    input.fields = input.fields.map((row) =>
      row.paperId === 'b' && row.fieldKey === 'limitations'
        ? field('b', 'limitations', [
            limitation.replace('is limited', 'is not limited'),
          ])
        : row,
    )
    expect(deriveResearchGaps(input)).toEqual([])
  })

  it.each(['not_reported', 'failed'] as const)(
    'never uses %s evidence even with residual items',
    (state) => {
      const input = fixture()
      input.fields = input.fields.map((row) => ({ ...row, state }))
      expect(deriveResearchGaps(input)).toEqual([])
    },
  )

  it.each([
    'methodology',
    'dataset',
    'findings',
    'objective',
    'concepts',
  ] as const)(
    'does not reinterpret %s evidence as limitation or future work',
    (fieldKey) => {
      expect(deriveResearchGaps(fixture(fieldKey, limitation))).toEqual([])
      expect(deriveResearchGaps(fixture(fieldKey, future))).toEqual([])
    },
  )

  it.each(['methodology', 'dataset'] as const)(
    'does not fabricate a gap from absent %s',
    (fieldKey) => {
      const input = fixture(fieldKey, 'Spectral graph convolution')
      input.fields = [
        ...input.fields.filter(
          (row) => row.paperId !== 'b' || row.fieldKey !== fieldKey,
        ),
        field('b', fieldKey, [], { state: 'not_reported' }),
      ]
      expect(deriveResearchGaps(input)).toEqual([])
    },
  )

  it('does not infer tensions even from apparently opposite findings', () => {
    const input = fixture(
      'findings',
      'Spectral graph convolution improves classification accuracy.',
    )
    input.fields = [
      ...input.fields,
      field(
        'b',
        'findings',
        ['Spectral graph convolution reduces classification accuracy.'],
        { updatedAt: 'c' },
      ),
    ]
    expect(deriveResearchGaps(input)).toEqual([])
  })

  it('propagates supporting staleness without dropping evidence or changing identity', () => {
    const input = fixture()
    const original = deriveResearchGaps(input)[0]
    input.researchMap.nodes = input.researchMap.nodes.map((node) =>
      node.type === 'paper' && node.paperId === 'a'
        ? { ...node, isStale: true }
        : node,
    )
    expect(deriveResearchGaps(input)[0]).toEqual({ ...original, isStale: true })
  })

  it('ignores staleness from unrelated papers', () => {
    const input = fixture()
    input.researchMap.nodes = input.researchMap.nodes.map((node) =>
      node.type === 'paper' && node.paperId === 'c'
        ? { ...node, isStale: true }
        : node,
    )
    expect(deriveResearchGaps(input)[0].isStale).toBe(false)
  })

  it('deduplicates rows/edges/nodes/candidates while preserving distinct claim indexes', () => {
    const input = fixture()
    input.fields = [
      ...input.fields,
      field('a', 'limitations', [limitation, limitation], { updatedAt: 'c' }),
    ]
    const original = deriveResearchGaps(input)
    expect(original[0].supportCount).toBe(2)
    expect(
      original[0].evidenceRefs.map((ref) => [ref.paperId, ref.itemIndex]),
    ).toEqual([
      ['a', 0],
      ['a', 1],
      ['b', 0],
    ])
    input.fields = [...input.fields, ...input.fields]
    input.researchMap.nodes = [
      ...input.researchMap.nodes,
      ...input.researchMap.nodes,
    ]
    input.researchMap.edges = [
      ...input.researchMap.edges,
      ...input.researchMap.edges,
    ]
    expect(deriveResearchGaps(input)).toEqual(original)
  })

  it('has stable explicit IDs, candidate ordering and evidence ordering under permutations', () => {
    const input = fixture()
    input.fields = [
      ...input.fields,
      ...['a', 'b'].map((id) => field(id, 'future_work', [future])),
    ]
    const original = deriveResearchGaps(input)
    expect(original).toHaveLength(2)
    expect(original.find((c) => c.type === 'recurring_limitation')?.id).toBe(
      `gap:v2:${JSON.stringify([
        'recurring_limitation',
        'claim-signature-v1',
        'limitations',
        'scope_restriction',
        `statement:${statementKey(limitation)}`,
        ['a', 'b'],
      ])}`,
    )
    for (let offset = 0; offset < input.fields.length; offset++) {
      expect(
        deriveResearchGaps({
          fields: [
            ...input.fields.slice(offset),
            ...input.fields.slice(0, offset),
          ].reverse(),
          researchMap: {
            nodes: [...input.researchMap.nodes].reverse(),
            edges: [...input.researchMap.edges].reverse(),
          },
        }),
      ).toEqual(original)
    }
  })

  it('normalizes case, Unicode and whitespace without stripping negation or internal punctuation', () => {
    expect(statementKey('  Ｓpectral  GRAPH convolution. ')).toBe(
      'spectral graph convolution',
    )
    expect(statementKey('cannot evaluate')).not.toBe(
      statementKey('can evaluate'),
    )
    expect(statementKey('a; b')).not.toBe(statementKey('a b'))
    expect(statementKey('matrix')).not.toBe(statementKey('matrices'))
    const input = fixture()
    input.fields = input.fields.map((row) =>
      row.fieldKey === 'limitations' && row.paperId === 'b'
        ? field('b', 'limitations', [limitation.toUpperCase()])
        : row,
    )
    expect(deriveResearchGaps(input)).toHaveLength(1)
  })

  it('uses the newest row, never resurrecting older positive evidence', () => {
    const input = fixture()
    input.fields = [
      ...input.fields,
      field('b', 'limitations', [], { state: 'not_reported', updatedAt: 'c' }),
    ]
    expect(deriveResearchGaps(input)).toEqual([])
  })

  it('rejects conflicting equal-revision fields independently of order', () => {
    const input = fixture()
    input.fields = [
      ...input.fields,
      field('b', 'limitations', ['Something else']),
    ]
    expect(deriveResearchGaps(input)).toEqual([])
    expect(
      deriveResearchGaps({ ...input, fields: [...input.fields].reverse() }),
    ).toEqual([])
  })

  it.each([
    null,
    {},
    { fields: [], researchMap: {} },
    { fields: [], researchMap: { nodes: [], edges: [] } },
  ])('fails safely for malformed/empty input %j', (input) => {
    expect(deriveResearchGaps(input as DeriveGapsInput)).toEqual([])
  })

  it.each([
    { itemsMalformed: true },
    { items: null },
    { items: [{ text: null }] },
    { items: [null] },
    { items: [] },
  ])(
    'rejects the whole malformed field, preserving indexes %j',
    (overrides) => {
      const input = fixture()
      input.fields = input.fields.map((row) =>
        row.paperId === 'b' && row.fieldKey === 'limitations'
          ? ({ ...row, ...overrides } as ExtractionField)
          : row,
      )
      expect(deriveResearchGaps(input)).toEqual([])
    },
  )

  it('rejects map edges with no provenance or a wrong relationship type', () => {
    const input = fixture()
    expect(
      deriveResearchGaps({
        ...input,
        researchMap: {
          ...input.researchMap,
          edges: input.researchMap.edges.map((edge) => ({
            ...edge,
            evidence: [],
          })),
        },
      }),
    ).toEqual([])
    expect(
      deriveResearchGaps({
        ...input,
        researchMap: {
          ...input.researchMap,
          edges: input.researchMap.edges.map((edge) => ({
            ...edge,
            type: 'paper_reports_finding',
          })),
        },
      }),
    ).toEqual([])
  })
})
