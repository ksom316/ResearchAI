import { describe, expect, it } from 'vitest'
import type { ExtractionField } from '#/features/evidence-matrix/types'
import type {
  EvidenceRef,
  PaperNode,
  ResearchMapEdge,
  TermKind,
  TermNode,
} from '#/features/research-map/types'
import { deriveResearchGaps } from './derive'
import { deriveGapClaimSignatures } from './signatures'
import type { DeriveGapsInput, GapClaimFieldKey } from './types'

const S0 =
  'The paper proposes integrating large models with table recognition and advancing comprehensive table understanding.'
const E0 =
  'Evaluate the model on table-image datasets written in other languages.'
const E1 =
  'Incorporate language models into the structure and cell-content decoders to improve performance.'
const T0 = 'Different models for TSR and L-OCR may improve accuracy.'
const T1 =
  "Build end-to-end models that account for L-OCR's sequential nature and TSR's non-sequential nature."

const field = (
  paperId: string,
  fieldKey: GapClaimFieldKey,
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

type Relationship = {
  id: string
  kind: TermKind
  key: string
  paperIds: string[]
}

function input(
  fields: ExtractionField[],
  relationships: Relationship[] = [],
  stalePaperIds: string[] = [],
): DeriveGapsInput {
  const paperIds = [
    ...new Set([
      ...fields.map((row) => row.paperId),
      ...relationships.flatMap((relationship) => relationship.paperIds),
    ]),
  ]
  const paperNodes: PaperNode[] = paperIds.map((paperId) => ({
    id: `paper:${paperId}`,
    type: 'paper',
    paperId,
    title: paperId,
    statusKey: 'extracted',
    extractionStatus: 'complete',
    isStale: stalePaperIds.includes(paperId),
    contributes: true,
  }))
  const termNodes: TermNode[] = relationships.map((relationship) => ({
    id: relationship.id,
    type: 'term',
    kind: relationship.kind,
    key: relationship.key,
    label: relationship.key,
    paperIds: [...relationship.paperIds],
  }))
  const edgeType = {
    concept: 'paper_has_concept',
    methodology: 'paper_uses_methodology',
    dataset: 'paper_uses_dataset',
  } as const
  const fieldKey = {
    concept: 'concepts',
    methodology: 'methodology',
    dataset: 'dataset',
  } as const
  const edges: ResearchMapEdge[] = relationships.flatMap((relationship) =>
    relationship.paperIds.map((paperId) => {
      const evidence: EvidenceRef = {
        paperId,
        fieldKey: fieldKey[relationship.kind],
        itemIndex: 0,
        matchedPhrase: relationship.key,
      }
      return {
        id: `edge:${relationship.id}:${paperId}`,
        type: edgeType[relationship.kind],
        from: `paper:${paperId}`,
        to: relationship.id,
        evidence: [evidence],
      }
    }),
  )
  return {
    fields,
    researchMap: { nodes: [...paperNodes, ...termNodes], edges },
  }
}

const oneSignature = (
  text: string,
  fieldKey: GapClaimFieldKey = 'future_work',
) => deriveGapClaimSignatures(input([field('paper', fieldKey, [text])]))

describe('controlled claim-signature vocabulary', () => {
  it.each(['integrate', 'integrating', 'incorporate', 'incorporating'])(
    'recognizes the integrate alias %s',
    (alias) => {
      expect(oneSignature(`${alias} language models.`)[0]?.actionFamily).toBe(
        'integrate',
      )
    },
  )

  it.each([
    ['evaluate', 'evaluate'],
    ['build', 'build'],
    ['building', 'build'],
  ] as const)('recognizes the future-work alias %s', (alias, family) => {
    expect(oneSignature(`${alias} language models.`)[0]?.actionFamily).toBe(
      family,
    )
  })

  it.each([
    ['limited', 'scope_restriction'],
    ['restricted', 'scope_restriction'],
    ['lack', 'missing_capability'],
    ['lacks', 'missing_capability'],
    ['cannot', 'inability'],
    ['unable', 'inability'],
    ['insufficient', 'insufficiency'],
  ] as const)('recognizes the limitation alias %s', (alias, family) => {
    expect(
      oneSignature(`Language models are ${alias} for this task.`, 'limitations')[0]
        ?.actionFamily,
    ).toBe(family)
  })

  it.each([
    ['language model', 'language_model'],
    ['language models', 'language_model'],
    ['table structure', 'table_structure'],
    ['table structure recognition', 'table_structure'],
    ['structure recognition', 'table_structure'],
    ['TSR', 'table_structure'],
    ['table content', 'table_content'],
    ['content recognition', 'table_content'],
    ['cell content', 'table_content'],
    ['cell-content', 'table_content'],
    ['L-OCR', 'table_content'],
  ] as const)('recognizes the target alias %s', (alias, family) => {
    expect(oneSignature(`Integrate ${alias}.`)[0]?.targetFamilies).toContain(
      family,
    )
  })

  it.each(['table recognition', 'table understanding'])(
    'uses local context to activate large models: %s',
    (context) => {
      const signature = oneSignature(
        `Integrating large models with ${context}.`,
      )[0]
      expect(signature).toMatchObject({
        actionFamily: 'integrate',
        targetFamilies: ['language_model'],
        contextFamilies: ['table_recognition_domain'],
      })
    },
  )

  it('normalizes NFKC, case, whitespace and hyphens with exact token boundaries', () => {
    const signature = oneSignature(
      '  ＩＮＣＯＲＰＯＲＡＴＥ   LANGUAGE models into CELL-CONTENT decoders. ',
    )[0]
    expect(signature.actionFamily).toBe('integrate')
    expect(signature.targetFamilies).toEqual([
      'language_model',
      'table_content',
    ])
    expect(oneSignature('Reintegrate language models.')).toEqual([])
    expect(oneSignature('Integrate languagemodels.')).toEqual([])
  })

  it.each([
    'Improve language models.',
    'Test language models.',
    'Develop language models.',
    'Explore language models.',
    'Investigate language models.',
    'Extend language models.',
    'Advance language models.',
    'Integrated language models.',
  ])('rejects the unlisted future-work wording %s', (text) => {
    expect(oneSignature(text)).toEqual([])
  })

  it('rejects only, bare OCR, generic models, languages and unguarded large models', () => {
    expect(oneSignature('Only language models are available.', 'limitations')).toEqual(
      [],
    )
    expect(oneSignature('Integrate OCR.')).toEqual([])
    expect(oneSignature('Integrate models.')).toEqual([])
    expect(oneSignature('Integrate support for other languages.')).toEqual([])
    expect(oneSignature('Integrate large models.')).toEqual([])
  })

  it('abstains for multiple incompatible actions and unresolved negation', () => {
    expect(oneSignature('Build and evaluate language models.')).toEqual([])
    for (const text of [
      'Do not integrate language models.',
      'No work should integrate language models.',
      'Never integrate language models.',
    ]) {
      expect(oneSignature(text)).toEqual([])
    }
  })
})

describe('claim-signature candidate matching', () => {
  const mapRelationships: Relationship[] = [
    {
      id: 'term:methodology:table structure',
      kind: 'methodology',
      key: 'table structure',
      paperIds: ['end', 'survey'],
    },
    {
      id: 'term:concept:structure recognition',
      kind: 'concept',
      key: 'structure recognition',
      paperIds: ['end', 'tables'],
    },
  ]

  it('recognizes only the validated S0/E1 positive control', () => {
    const fields = [
      field('survey', 'future_work', [S0]),
      field('end', 'future_work', [E0, E1]),
      field('tables', 'future_work', [T0, T1]),
    ]
    const signatures = deriveGapClaimSignatures(input(fields, mapRelationships))
    expect(signatures.find((s) => s.evidenceRef.paperId === 'survey')).toMatchObject(
      {
        actionFamily: 'integrate',
        targetFamilies: ['language_model'],
        contextFamilies: ['table_recognition_domain'],
      },
    )
    expect(
      signatures.find(
        (s) => s.evidenceRef.paperId === 'end' && s.evidenceRef.itemIndex === 1,
      ),
    ).toMatchObject({
      actionFamily: 'integrate',
      targetFamilies: ['language_model', 'table_content'],
    })

    const candidates = deriveResearchGaps(input(fields, mapRelationships))
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      type: 'future_research_opportunity',
      paperIds: ['end', 'survey'],
      supportCount: 2,
      evidenceCount: 2,
      relatedTermIds: ['term:methodology:table structure'],
      isStale: false,
      evidenceRefs: [
        {
          paperId: 'end',
          fieldKey: 'future_work',
          itemIndex: 1,
          matchedPhrase: null,
        },
        {
          paperId: 'survey',
          fieldKey: 'future_work',
          itemIndex: 0,
          matchedPhrase: null,
        },
      ],
      signals: [
        {
          type: 'matching_claim_signatures',
          rulesetVersion: 'claim-signature-v1',
          fieldKey: 'future_work',
          actionFamily: 'integrate',
          targetFamily: 'language_model',
        },
        {
          type: 'shared_map_term',
          termId: 'term:methodology:table structure',
        },
      ],
    })
  })

  it('rejects S0/E0, S0/T0, S0/T1, T0/E1 and T1/E1', () => {
    const pairs = [
      [field('survey', 'future_work', [S0]), field('end', 'future_work', [E0])],
      [field('survey', 'future_work', [S0]), field('tables', 'future_work', [T0])],
      [field('survey', 'future_work', [S0]), field('tables', 'future_work', [T1])],
      [field('tables', 'future_work', [T0]), field('end', 'future_work', [E1])],
      [field('tables', 'future_work', [T1]), field('end', 'future_work', [E1])],
    ]
    for (const fields of pairs) {
      expect(deriveResearchGaps(input(fields, mapRelationships))).toEqual([])
    }
  })

  it('keeps table and NLP signatures isolated without a direct typed relationship', () => {
    const fields = [
      field('survey', 'future_work', [S0]),
      field('bert', 'future_work', [
        'Incorporate language models into token classification.',
      ]),
    ]
    const relationships: Relationship[] = [
      {
        id: 'term:methodology:table structure',
        kind: 'methodology',
        key: 'table structure',
        paperIds: ['survey', 'end'],
      },
      {
        id: 'term:methodology:masked language modeling',
        kind: 'methodology',
        key: 'masked language modeling',
        paperIds: ['bert', 'roberta'],
      },
    ]
    expect(deriveResearchGaps(input(fields, relationships))).toEqual([])
  })

  it('propagates stale status and preserves V2 identity and provenance', () => {
    const fields = [
      field('survey', 'future_work', [S0]),
      field('end', 'future_work', [E1]),
    ]
    const fresh = deriveResearchGaps(input(fields, mapRelationships))[0]
    const stale = deriveResearchGaps(
      input(fields, mapRelationships, ['survey']),
    )[0]
    expect(stale).toEqual({ ...fresh, isStale: true })
    expect(stale.id).toBe(
      'gap:v2:["future_research_opportunity","claim-signature-v1","future_work","integrate","target:language_model",["end","survey"]]',
    )
  })
})
