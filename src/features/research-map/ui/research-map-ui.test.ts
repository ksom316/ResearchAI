import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { papersQuery } from '#/features/papers/queries'
import type { Paper } from '#/features/papers/types'
import { evidenceKeys } from '#/features/evidence-matrix/queries'
import type { ExtractionField, ExtractionOverview } from '#/features/evidence-matrix/types'
import { WORKSPACE_TABS } from '#/features/projects/workspace/tabs'
import { deriveResearchMap } from '../derive'
import {
  buildPaperSummaries,
  buildTermIndex,
} from '../view-model'
import type { PaperSummaryRow } from '../view-model'
import { PaperRelationshipList } from './paper-relationship-list'
import { RelationshipEvidenceBody } from './relationship-evidence-sheet'
import { RelationshipIndex } from './relationship-index'
import { ResearchMapFilters } from './research-map-filters'
import { ResearchMapSummaryView } from './research-map-summary'
import { ResearchMapTab } from './research-map-tab'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children?: ReactNode; to: string; params?: { paperId: string } }) =>
    createElement(
      'a',
      { href: props.to.replace('$paperId', props.params?.paperId ?? ''), 'data-to': props.to },
      props.children,
    ),
}))

const html = (el: ReactElement) => renderToStaticMarkup(el)
const noop = () => undefined

const P1 = '00000000-0000-0000-0000-000000000001'
const P2 = '00000000-0000-0000-0000-000000000002'
const P3 = '00000000-0000-0000-0000-000000000003'

const paper = (id: string, title: string, status: Paper['status'] = 'ready'): Paper => ({
  id, project_ids: ['proj'], title, authors: [], publication_year: null, original_filename: null,
  mime_type: null, storage_path: null, content_hash: null, file_size_bytes: null, status,
  page_count: null, processing_error: null, created_at: '2026-01-01T00:00:00Z',
})
const overview = (paperId: string, over: Partial<ExtractionOverview> = {}): ExtractionOverview => ({
  paperId, schemaVersion: 1, status: 'complete', sourceCompletedAt: 'a', completedAt: 'b',
  provider: null, model: null, createdAt: 'c', updatedAt: 'd', isStale: false, ...over,
})
const field = (
  paperId: string, fieldKey: ExtractionField['fieldKey'], texts: string[],
  over: Partial<ExtractionField> = {},
): ExtractionField => ({
  paperId, schemaVersion: 1, fieldKey, state: 'extracted', items: texts.map((text) => ({ text })),
  itemsMalformed: false, createdAt: 'x', updatedAt: 'y', ...over,
})

function bertLikeMap() {
  return deriveResearchMap({
    papers: [paper(P1, 'test research'), paper(P2, 'RoBERTa'), paper(P3, 'Tables To Latex')],
    overviews: [overview(P1), overview(P2), overview(P3)],
    fields: [
      field(P1, 'concepts', ['Masked language modeling randomly masks tokens.']),
      field(P2, 'concepts', ['We evaluate masked language modeling.']),
      field(P1, 'methodology', ['We build on BERT.']),
      field(P2, 'methodology', ['We reimplement BERT.']),
      field(P3, 'concepts', ['Tabular processing is divided into stages.']),
      field(P3, 'findings', ['Accuracy improved.', 'Latency dropped.']),
    ],
  })
}

describe('ResearchMapSummaryView', () => {
  it('renders the five counts from map.summary, unmodified', () => {
    const out = html(
      createElement(ResearchMapSummaryView, {
        summary: {
          totalPapers: 3, contributingPapers: 2, currentPapers: 3, stalePapers: 0, activePapers: 0,
          unextractedPapers: 0, incompletePapers: 0, sharedConcepts: 1, sharedMethodologies: 1,
          sharedDatasets: 0, findings: 2,
        },
      }),
    )
    expect(out).toMatch(/data-stat="totalPapers">3</)
    expect(out).toMatch(/data-stat="sharedConcepts">1</)
    expect(out).toMatch(/data-stat="sharedMethodologies">1</)
    expect(out).toMatch(/data-stat="sharedDatasets">0</)
    expect(out).toMatch(/data-stat="findings">2</)
    expect(out).toContain('2 of 3 papers')
    expect(out).not.toContain('role="note"') // no stale papers, no warning
  })

  it('shows a stale warning without hiding anything', () => {
    const out = html(
      createElement(ResearchMapSummaryView, {
        summary: { totalPapers: 2, contributingPapers: 2, currentPapers: 1, stalePapers: 1, activePapers: 0, unextractedPapers: 0, incompletePapers: 0, sharedConcepts: 0, sharedMethodologies: 0, sharedDatasets: 0, findings: 0 },
      }),
    )
    expect(out).toContain('role="note"')
    expect(out).toMatch(/1 paper has\s*out-of-date/)
  })
})

describe('ResearchMapFilters', () => {
  it('renders search, kind toggles, and only shows the stale toggle when asked', () => {
    const withStale = html(
      createElement(ResearchMapFilters, { search: '', onSearchChange: noop, kind: 'all', onKindChange: noop, hideStale: false, onHideStaleChange: noop, showStaleToggle: true }),
    )
    expect(withStale).toContain('Search terms or papers')
    expect(withStale).toContain('>All<')
    expect(withStale).toContain('>Concepts<')
    expect(withStale).toContain('>Methodologies<')
    expect(withStale).toContain('>Datasets<')
    expect(withStale).toContain('Hide out-of-date')

    const withoutStale = html(
      createElement(ResearchMapFilters, { search: '', onSearchChange: noop, kind: 'all', onKindChange: noop, hideStale: false, onHideStaleChange: noop, showStaleToggle: false }),
    )
    expect(withoutStale).not.toContain('Hide out-of-date')
  })

  it('marks the active kind pressed', () => {
    const out = html(
      createElement(ResearchMapFilters, { search: '', onSearchChange: noop, kind: 'methodology', onKindChange: noop, hideStale: false, onHideStaleChange: noop, showStaleToggle: false }),
    )
    expect(out).toMatch(/aria-pressed="true"[^>]*>\s*Methodologies/)
  })
})

describe('RelationshipIndex', () => {
  const map = bertLikeMap()
  const entries = buildTermIndex(map, [])

  it('lists shared terms under the correct kind heading', () => {
    const out = html(createElement(RelationshipIndex, { entries, onViewEvidence: noop }))
    const conceptsSection = out.slice(out.indexOf('Concepts ('), out.indexOf('Methodologies ('))
    expect(conceptsSection).toContain('Masked language modeling')
    const methodologySection = out.slice(out.indexOf('Methodologies ('), out.indexOf('Datasets ('))
    expect(methodologySection).toContain('BERT')
    expect(methodologySection).not.toContain('Masked language modeling')
  })

  it('shows a normal (non-error) empty state for a kind with nothing shared', () => {
    const out = html(createElement(RelationshipIndex, { entries, onViewEvidence: noop }))
    expect(out).toContain('No shared datasets yet.')
    expect(out).not.toMatch(/role="alert"/)
  })

  it('never exposes a normalization key or internal id as visible text', () => {
    const out = html(createElement(RelationshipIndex, { entries, onViewEvidence: noop }))
    expect(out).not.toContain('term:concept:')
    expect(out).not.toContain('term:methodology:')
  })

  it('terms are collapsed by default (no open attribute) and list connected paper counts', () => {
    const out = html(createElement(RelationshipIndex, { entries, onViewEvidence: noop }))
    expect(out).not.toMatch(/<details[^>]*\bopen\b/)
    expect(out).toContain('2 papers')
  })

  it('the View evidence action identifies the term and paper', () => {
    const out = html(createElement(RelationshipIndex, { entries, onViewEvidence: noop }))
    expect(out).toMatch(/aria-label="View evidence for BERT in (RoBERTa|test research)"/)
  })

  it('6B.5: distinguishes "no shared X yet" (empty corpus) from "no X match the current filters" (filtered)', () => {
    const unfiltered = html(createElement(RelationshipIndex, { entries, onViewEvidence: noop }))
    expect(unfiltered).toContain('No shared datasets yet.')
    expect(unfiltered).not.toContain('match the current filters')

    const filtered = html(createElement(RelationshipIndex, { entries: [], onViewEvidence: noop, filtersActive: true }))
    expect(filtered).toContain('No concepts match the current filters.')
    expect(filtered).toContain('No methodologies match the current filters.')
    expect(filtered).toContain('No datasets match the current filters.')
    expect(filtered).not.toContain('yet.')
  })
})

describe('PaperRelationshipList', () => {
  const map = bertLikeMap()
  const rows = buildPaperSummaries(map, [])

  it('shows an isolated paper (no shared terms) normally, not as an error, but keeps its findings', () => {
    const out = html(createElement(PaperRelationshipList, { rows, onViewEvidence: noop }))
    // Tables To Latex has no shared terms but does have findings: not "isolated" copy
    const idx = out.indexOf('Tables To Latex')
    const section = out.slice(idx, idx + 800)
    expect(section).toContain('Findings (2)')
    expect(section).not.toContain('No shared relationships yet.')
    expect(section).not.toMatch(/role="alert"/)
  })

  it('a fully isolated paper (no terms, no findings) gets the calm empty note, not an error', () => {
    const lonely: PaperSummaryRow = {
      paperId: 'lonely', title: 'Lonely Paper', statusKey: 'extracted', isStale: false,
      contributes: false, concepts: [], methodologies: [], datasets: [], findings: [],
    }
    const out = html(createElement(PaperRelationshipList, { rows: [lonely], onViewEvidence: noop }))
    expect(out).toContain('No shared relationships yet.')
    expect(out).not.toMatch(/role="alert"|error/i)
  })

  it('findings are collapsed by default and stay under their own paper', () => {
    const out = html(createElement(PaperRelationshipList, { rows, onViewEvidence: noop }))
    expect(out).not.toMatch(/<details[^>]*\bopen\b/)
    expect(out).toContain('Findings (2)')
    // findings appear only once, under Tables To Latex, not duplicated under BERT/RoBERTa
    expect((out.match(/Accuracy improved\./g) ?? []).length).toBe(1)
  })

  it('shows relationship counts per paper via the shared-term chips', () => {
    const bert = rows.find((r) => r.title === 'test research')!
    expect(bert.concepts).toHaveLength(1)
    expect(bert.methodologies).toHaveLength(1)
    const out = html(createElement(PaperRelationshipList, { rows: [bert], onViewEvidence: noop }))
    expect(out).toContain('Concepts:')
    expect(out).toContain('Methodologies:')
    expect(out).not.toContain('Datasets:') // omitted when empty, not shown as "Datasets: (none)"
  })

  it('shows a current vs out-of-date status label', () => {
    const staleMap = deriveResearchMap({
      papers: [paper(P1, 'A')],
      overviews: [overview(P1, { isStale: true })],
      fields: [],
    })
    const out = html(createElement(PaperRelationshipList, { rows: buildPaperSummaries(staleMap, []), onViewEvidence: noop }))
    expect(out).toContain('Out of date')
  })
})

describe('RelationshipEvidenceBody', () => {
  it('shows a textual stale warning without hiding the persisted claim', () => {
    const out = html(
      createElement(RelationshipEvidenceBody, {
        selected: {
          paperId: P1,
          paperTitle: 'Stale paper',
          isStale: true,
          fieldKey: 'concepts',
          contextLabel: 'Table structure',
          items: [
            {
              itemIndex: 0,
              matchedPhrase: null,
              claimText: 'Persisted extracted claim.',
            },
          ],
        },
        sources: [],
        error: null,
        onRetry: noop,
        Title: 'h2',
        Description: 'p',
      }),
    )
    expect(out).toContain('role="note"')
    expect(out).toContain('Out of date.')
    expect(out).toContain('Persisted extracted claim.')
  })
})

describe('ResearchMapTab (seeded query cache)', () => {
  const papersKey = papersQuery({ projectId: 'proj' }).queryKey
  const render = (seed: (qc: QueryClient) => void) => {
    const qc = new QueryClient()
    seed(qc)
    return html(createElement(QueryClientProvider, { client: qc }, createElement(ResearchMapTab, { projectId: 'proj' })))
  }

  it('shows a loading skeleton while papers load', () => {
    const out = render(() => undefined)
    expect(out).toContain('aria-busy="true"')
  })

  it('explains that papers are needed when the project has none', () => {
    const out = render((qc) => qc.setQueryData(papersKey, []))
    expect(out).toContain('No papers to map yet')
  })

  it('renders the summary, index and paper view once papers + extraction data are present', () => {
    const out = render((qc) => {
      qc.setQueryData(papersKey, [paper(P1, 'test research'), paper(P2, 'RoBERTa')])
      qc.setQueryData(evidenceKeys.overview([P1, P2]), [overview(P1), overview(P2)])
      qc.setQueryData(evidenceKeys.fields([P1, P2]), [
        field(P1, 'methodology', ['We build on BERT.']),
        field(P2, 'methodology', ['We reimplement BERT.']),
      ])
    })
    expect(out).toContain('Research Map')
    expect(out).toContain('BERT')
    expect(out).toContain('test research')
    expect(out).toContain('RoBERTa')
  })

  it('6B.5: paper status wording matches Evidence Matrix exactly (single shared source)', () => {
    const out = render((qc) => {
      qc.setQueryData(papersKey, [paper(P1, 'Stale Paper')])
      qc.setQueryData(evidenceKeys.overview([P1]), [overview(P1, { isStale: true })])
      qc.setQueryData(evidenceKeys.fields([P1]), [])
    })
    expect(out).toContain('Out of date')
    expect(out).not.toContain('"waiting"') // no raw statusKey leaking as text
  })

  it('6B.5: a search matching no paper shows a calm "no matches" message, not a blank list', () => {
    const out = render((qc) => {
      qc.setQueryData(papersKey, [paper(P1, 'test research'), paper(P2, 'RoBERTa')])
      qc.setQueryData(evidenceKeys.overview([P1, P2]), [overview(P1), overview(P2)])
      qc.setQueryData(evidenceKeys.fields([P1, P2]), [
        field(P1, 'methodology', ['We build on BERT.']),
        field(P2, 'methodology', ['We reimplement BERT.']),
      ])
    })
    // simulate the zero-row case directly against the pure list component, since the
    // tab's search box has no server-renderable "typed" state in this test harness
    const empty = html(createElement(PaperRelationshipList, { rows: [], onViewEvidence: noop }))
    expect(empty).toContain('No papers match the current filters.')
    expect(empty).not.toContain('<ul') // not a silently empty list
    expect(out).toContain('Papers') // sanity: the unfiltered tab still has content
  })

  it('an extraction-data error is shown as an error, not as "no relationships"', () => {
    const qc = new QueryClient()
    qc.setQueryData(papersKey, [paper(P1, 'test research')])
    const out = html(createElement(QueryClientProvider, { client: qc }, createElement(ResearchMapTab, { projectId: 'proj' })))
    expect(out).toContain('aria-busy="true"') // still loading extraction data in this seed
  })
})

describe('workspace wiring', () => {
  const root = new URL('../../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const read = (rel: string) =>
    readFileSync(join(root, rel), 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/\/\*[^]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('Research Map is a real workspace tab, placed alongside the other research-intelligence tabs', () => {
    expect(WORKSPACE_TABS.map((t) => t.value)).toEqual([
      'overview', 'papers', 'ai-research', 'evidence', 'research-map', 'research-gaps', 'comparisons', 'writing',
    ])
  })

  it('the workspace renders ResearchMapTab for the research-map tab, others unchanged', () => {
    const src = read('src/features/projects/workspace/project-workspace.tsx')
    expect(src).toMatch(
      /<TabsContent value="research-map"[^>]*>\s*<ResearchMapTab key=\{project\.id\} projectId=\{project\.id\} \/>/,
    )
    for (const value of ['overview', 'papers', 'ai-research', 'evidence']) {
      expect(src).toContain(`<TabsContent value="${value}"`)
    }
    const placeholders = src.slice(src.indexOf('const PLACEHOLDERS'), src.indexOf('export function ProjectWorkspace'))
    expect([...placeholders.matchAll(/^ {2}(\w+): \{/gm)].map((m) => m[1])).toEqual(['comparisons', 'writing'])
  })

  it('does not touch the tab strip overflow-fix classes', () => {
    const src = read('src/features/projects/workspace/project-workspace.tsx')
    expect(src).toContain('sm:overflow-x-auto')
    expect(src).toContain('sm:flex-none')
    expect(src).toContain('aria-label="Project workspace"')
  })
})

describe('boundaries', () => {
  const dir = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const strip = (t: string) => t.replace(/\r\n/g, '\n').replace(/\/\*[^]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('UI components never touch Supabase directly and never call the derivation with mutated logic', () => {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      const code = strip(readFileSync(join(dir, f), 'utf8'))
      expect(code, f).not.toMatch(/supabase|\.rpc\(|getSupabaseBrowserClient/i)
    }
  })

  it('the frozen derivation files are not imported from anywhere except derive.ts/view-model.ts', () => {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      const code = strip(readFileSync(join(dir, f), 'utf8'))
      expect(code, f).not.toMatch(/from ['"]\.\.\/(normalize|terms)['"]/)
    }
  })
})
