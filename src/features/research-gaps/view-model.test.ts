import { describe, expect, it } from 'vitest'
import type {
  ExtractionField,
  ExtractionOverview,
} from '#/features/evidence-matrix/types'
import type { ResearchMap } from '#/features/research-map/types'
import {
  GAP_ACTION_LABELS,
  GAP_TARGET_LABELS,
  GAP_TYPE_LABELS,
  explainGapSignals,
  gapDisplayHeading,
} from './presentation'
import {
  availableGapTypes,
  buildGapCandidateView,
  buildGapEvidenceSelection,
  deriveResearchGapsState,
  filterGapCandidates,
  summarizeResearchGaps,
} from './view-model'
import type { GapCandidate, GapType } from './types'

const END = 'end'
const SURVEY = 'survey'
const TERM = 'term:methodology:table structure'

const candidate = (
  overrides: Partial<GapCandidate> = {},
): GapCandidate => ({
  id: 'gap:v2:positive',
  type: 'future_research_opportunity',
  title: 'Potential future research opportunity in this corpus',
  description:
    '2 directly related papers express a matching future-work direction (integrate / language model). This is a potential gap in this corpus.',
  paperIds: [END, SURVEY],
  relatedTermIds: [TERM],
  evidenceRefs: [
    {
      paperId: END,
      fieldKey: 'future_work',
      itemIndex: 1,
      matchedPhrase: null,
    },
    {
      paperId: SURVEY,
      fieldKey: 'future_work',
      itemIndex: 0,
      matchedPhrase: null,
    },
  ],
  supportCount: 2,
  evidenceCount: 2,
  isStale: false,
  signals: [
    {
      type: 'matching_claim_signatures',
      rulesetVersion: 'claim-signature-v1',
      fieldKey: 'future_work',
      actionFamily: 'integrate',
      targetFamily: 'language_model',
    },
    { type: 'shared_map_term', termId: TERM },
  ],
  ...overrides,
})

const map: ResearchMap = {
  nodes: [
    {
      id: `paper:${END}`,
      type: 'paper',
      paperId: END,
      title: 'End to end',
      statusKey: 'extracted',
      extractionStatus: 'complete',
      isStale: false,
      contributes: true,
    },
    {
      id: `paper:${SURVEY}`,
      type: 'paper',
      paperId: SURVEY,
      title: 'ssrn-4757419',
      statusKey: 'extracted',
      extractionStatus: 'complete',
      isStale: false,
      contributes: true,
    },
    {
      id: TERM,
      type: 'term',
      kind: 'methodology',
      key: 'table structure',
      label: 'Table structure',
      paperIds: [END, SURVEY],
    },
  ],
  edges: [],
  summary: {
    totalPapers: 2,
    contributingPapers: 2,
    currentPapers: 2,
    stalePapers: 0,
    activePapers: 0,
    unextractedPapers: 0,
    incompletePapers: 0,
    sharedConcepts: 0,
    sharedMethodologies: 1,
    sharedDatasets: 0,
    findings: 0,
  },
  diagnostics: {
    unsharedCandidates: { concept: 0, methodology: 0, dataset: 0 },
  },
}

const field = (
  paperId: string,
  texts: string[],
  updatedAt = 'b',
): ExtractionField => ({
  paperId,
  schemaVersion: 1,
  fieldKey: 'future_work',
  state: 'extracted',
  items: texts.map((text) => ({ text })),
  itemsMalformed: false,
  createdAt: 'a',
  updatedAt,
})

const overview = (paperId: string): ExtractionOverview => ({
  paperId,
  schemaVersion: 1,
  status: 'complete',
  sourceCompletedAt: 'a',
  completedAt: 'b',
  provider: 'provider',
  model: 'model',
  createdAt: 'a',
  updatedAt: 'b',
  isStale: false,
})

describe('Research Gap presentation', () => {
  it('has human-readable labels for every GapType', () => {
    expect(GAP_TYPE_LABELS).toEqual({
      recurring_limitation: 'Recurring limitation',
      future_research_opportunity: 'Future research opportunity',
      methodology_gap: 'Methodology gap',
      dataset_coverage_gap: 'Dataset coverage gap',
      finding_tension: 'Finding tension',
    } satisfies Record<GapType, string>)
  })

  it('has deterministic action and target labels and display heading', () => {
    expect(GAP_ACTION_LABELS.integrate).toBe('Integration')
    expect(GAP_TARGET_LABELS.language_model).toBe('Language model')
    expect(GAP_TARGET_LABELS.table_structure).toBe('Table structure')
    expect(GAP_TARGET_LABELS.table_content).toBe('Table content')
    expect(gapDisplayHeading(candidate())).toBe('Language-model integration')
    expect(
      gapDisplayHeading(
        candidate({
          signals: [{ type: 'shared_map_term', termId: TERM }],
        }),
      ),
    ).toBe('Potential future research opportunity in this corpus')
  })

  it('explains signature and map-term signals without exposing ids', () => {
    const explanations = explainGapSignals(
      candidate(),
      new Map([[TERM, { label: 'Table structure' }]]),
    )
    expect(explanations).toEqual([
      'These directly related papers describe a matching future-work direction involving integration and language models.',
      'Research Map relationship: Table structure',
    ])
    expect(explanations.join(' ')).not.toContain(TERM)
  })
})

describe('Research Gap view model', () => {
  it('represents a valid zero-candidate corpus as ready, not an error', () => {
    const papers = [
      { id: END, title: 'End to end', status: 'ready' as const },
      { id: SURVEY, title: 'ssrn-4757419', status: 'ready' as const },
    ]
    const state = deriveResearchGapsState({
      papers: { data: papers, error: null, isPending: false },
      overviews: {
        data: [overview(END), overview(SURVEY)],
        error: null,
        isPending: false,
      },
      fields: { data: [], error: null, isPending: false },
    })
    expect(state.kind).toBe('ready')
    if (state.kind === 'ready') expect(state.candidates).toEqual([])
  })

  it('distinguishes loading, errors, no papers and insufficient intelligence', () => {
    const none = { data: undefined, error: null, isPending: true }
    expect(
      deriveResearchGapsState({ papers: none, overviews: none, fields: none }),
    ).toEqual({ kind: 'loading' })
    expect(
      deriveResearchGapsState({
        papers: { data: [], error: null, isPending: false },
        overviews: none,
        fields: none,
      }),
    ).toEqual({ kind: 'empty' })
    const failure = new Error('Could not load evidence')
    expect(
      deriveResearchGapsState({
        papers: {
          data: [{ id: END, title: 'End', status: 'ready' }],
          error: null,
          isPending: false,
        },
        overviews: { data: undefined, error: failure, isPending: false },
        fields: { data: [], error: null, isPending: false },
      }),
    ).toEqual({ kind: 'error', source: 'extraction', error: failure })
    expect(
      deriveResearchGapsState({
        papers: {
          data: [{ id: END, title: 'End', status: 'ready' }],
          error: null,
          isPending: false,
        },
        overviews: { data: [], error: null, isPending: false },
        fields: { data: [], error: null, isPending: false },
      }),
    ).toEqual({ kind: 'not_ready' })
  })

  it('summarizes unique papers and evidence claims', () => {
    const duplicateRef = candidate().evidenceRefs[0]
    expect(
      summarizeResearchGaps([
        candidate({ evidenceRefs: [...candidate().evidenceRefs, duplicateRef] }),
        candidate({
          id: 'stale',
          paperIds: [END],
          evidenceRefs: [duplicateRef],
          isStale: true,
        }),
      ]),
    ).toEqual({
      potentialGaps: 2,
      supportingPapers: 2,
      evidenceClaims: 2,
      current: 1,
      stale: 1,
    })
  })

  it('filters deterministically by type, freshness and both together', () => {
    const future = candidate()
    const limitation = candidate({
      id: 'limitation',
      type: 'recurring_limitation',
      isStale: true,
    })
    const rows = [future, limitation]
    expect(availableGapTypes(rows)).toEqual([
      'future_research_opportunity',
      'recurring_limitation',
    ])
    expect(
      filterGapCandidates(rows, {
        type: 'future_research_opportunity',
        status: 'all',
      }),
    ).toEqual([future])
    expect(filterGapCandidates(rows, { type: 'all', status: 'current' })).toEqual([
      future,
    ])
    expect(filterGapCandidates(rows, { type: 'all', status: 'stale' })).toEqual([
      limitation,
    ])
    expect(
      filterGapCandidates(rows, {
        type: 'future_research_opportunity',
        status: 'stale',
      }),
    ).toEqual([])
  })

  it('presents the five-paper positive candidate with paper and term labels', () => {
    expect(buildGapCandidateView(candidate(), map)).toMatchObject({
      heading: 'Language-model integration',
      typeLabel: 'Future research opportunity',
      papers: [
        { paperId: END, title: 'End to end' },
        { paperId: SURVEY, title: 'ssrn-4757419' },
      ],
      relatedTerms: [{ termId: TERM, label: 'Table structure' }],
    })
  })

  it('handles missing paper and term metadata safely', () => {
    const view = buildGapCandidateView(candidate(), { nodes: [] })
    expect(view.papers.map((paper) => paper.title)).toEqual([
      'Unknown paper',
      'Unknown paper',
    ])
    expect(view.relatedTerms[0].label).toBe('Related corpus term')
  })

  it('resolves evidence refs, deduplicates duplicates and preserves item indexes', () => {
    const fields = [
      field(END, ['E0', 'Persisted E1']),
      field(SURVEY, ['Persisted S0']),
    ]
    const withDuplicate = candidate({
      evidenceRefs: [
        ...candidate().evidenceRefs,
        candidate().evidenceRefs[0],
      ],
    })
    const selection = buildGapEvidenceSelection(withDuplicate, map, fields)
    expect(selection.evidencePapers).toEqual([
      {
        paperId: END,
        title: 'End to end',
        claims: [
          {
            fieldKey: 'future_work',
            fieldLabel: 'Future Work',
            itemIndex: 1,
            text: 'Persisted E1',
          },
        ],
      },
      {
        paperId: SURVEY,
        title: 'ssrn-4757419',
        claims: [
          {
            fieldKey: 'future_work',
            fieldLabel: 'Future Work',
            itemIndex: 0,
            text: 'Persisted S0',
          },
        ],
      },
    ])
  })

  it('uses the newest claim row and fails safely for conflicting or missing claims', () => {
    const fields = [
      field(END, ['old', 'Old E1'], 'a'),
      field(END, ['new', 'New E1'], 'b'),
      field(SURVEY, ['One'], 'b'),
      field(SURVEY, ['Conflict'], 'b'),
    ]
    const selection = buildGapEvidenceSelection(candidate(), map, fields)
    expect(selection.evidencePapers[0].claims[0].text).toBe('New E1')
    expect(selection.evidencePapers[1].claims[0].text).toBe(
      'Extracted claim unavailable.',
    )
  })

  it('exposes the stale warning state without hiding the candidate', () => {
    const selection = buildGapEvidenceSelection(
      candidate({ isStale: true }),
      map,
      [field(END, ['E0', 'E1']), field(SURVEY, ['S0'])],
    )
    expect(selection.showStaleWarning).toBe(true)
    expect(selection.evidencePapers).toHaveLength(2)
  })
})
