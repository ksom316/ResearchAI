import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { GroundedDraft } from '#/features/writer/types'
import { GroundedDraftView } from '#/features/writer/ui/grounded-draft-view'
import { ClaimSupportStatus } from './claim-support-status'

const root = new URL('../../../', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
)
const read = (relative: string) => readFileSync(join(root, relative), 'utf8')

const draft: GroundedDraft = {
  title: 'Grounded draft',
  mode: 'findings_synthesis',
  paragraphs: [
    {
      units: [
        { id: 'U1', text: 'First generated statement.', citationIds: ['W1'] },
        { id: 'U2', text: 'Second generated statement.', citationIds: ['W1', 'W2'] },
      ],
    },
  ],
  citations: [
    {
      id: 'W1',
      paperId: '11111111-1111-4111-8111-111111111111',
      paperTitle: 'A long first paper title',
      locator: {
        kind: 'chunk',
        paperId: '11111111-1111-4111-8111-111111111111',
        chunkId: '44444444-4444-4444-8444-444444444444',
        sectionId: '55555555-5555-4555-8555-555555555555',
      },
      sources: [],
    },
    {
      id: 'W2',
      paperId: '22222222-2222-4222-8222-222222222222',
      paperTitle: 'A long second paper title',
      locator: {
        kind: 'extraction_claim',
        paperId: '22222222-2222-4222-8222-222222222222',
        schemaVersion: 1,
        fieldKey: 'findings',
        itemIndex: 0,
      },
      sources: [],
    },
  ],
  coverage: {
    projectPaperCount: 2,
    selectedPaperCount: 2,
    participatingPaperCount: 2,
    unavailablePaperCount: 0,
    evidenceItemCount: 2,
  },
}

describe('Claim Checker UI integration', () => {
  it('renders one explicit Check support action for every generated unit', () => {
    const html = renderToStaticMarkup(
      createElement(GroundedDraftView, {
        projectId: '33333333-3333-4333-8333-333333333333',
        draft,
        onSelectCitation: () => undefined,
      }),
    )
    expect((html.match(/>Check support<\/button>/g) ?? []).length).toBe(2)
    expect(html).toContain('>[1]</button>')
    expect(html).toContain('>[2]</button>')
    expect(html).not.toContain('>W1<')
    expect(html).not.toContain('>U1<')
  })

  it.each([
    ['supported', 'Supported by cited evidence'],
    ['partially_supported', 'Partially supported by cited evidence'],
    ['unsupported', 'Not supported by cited evidence'],
    ['insufficient_evidence', 'Insufficient cited evidence'],
  ] as const)('renders %s with explicit accessible text', (support, label) => {
    const html = renderToStaticMarkup(
      createElement(ClaimSupportStatus, { support }),
    )
    expect(html).toContain(label)
    expect(html).toContain('aria-hidden="true"')
  })

  it('submits only the strict unit selectors after an explicit click', () => {
    const action = read('features/claim-checker/ui/claim-check-button.tsx')
    expect(action).toContain('onClick={() => void checkSupport()}')
    expect(action).toContain('checkClaimSupportFn({ data: request })')
    expect(action).toContain('citationId: citation.id')
    expect(action).toContain('locator: citation.locator')
    expect(action).toContain('if (!request || checking) return')
    expect(action).not.toMatch(/evidenceText|excerpt|provider|model|prompt|\bC\d+\b/)
  })

  it('renders safe states and never renders rejected provider content', () => {
    const sheet = read('features/claim-checker/ui/claim-check-sheet.tsx')
    const presentation = read('features/claim-checker/presentation.ts')
    expect(sheet).toContain('Evidence-support assessment')
    expect(sheet).toContain('Checking the statement against its cited evidence')
    expect(sheet).toContain('assessment.unsupportedFragments.map')
    expect(sheet).toContain('assessment.citations.map')
    expect(sheet).toContain('claimCheckResultMessage(result)')
    expect(presentation).toContain('No result was displayed.')
    expect(sheet).not.toMatch(/rawOutput|providerResponse|dangerouslySetInnerHTML/)
  })

  it('preserves global numbering and reuses lazy Writer provenance', () => {
    const sheet = read('features/claim-checker/ui/claim-check-sheet.tsx')
    expect(sheet).toContain('[{source.number}]')
    expect(sheet).toContain('setEvidenceSelection')
    expect(sheet).toContain('<WriterCitationSheet')
    expect(sheet).not.toContain('getWriterCitationProvenanceFn')
    expect(sheet).toContain('to="/papers/$paperId"')
    expect(sheet).toContain('overflow-y-auto')
    expect(sheet).toContain('break-words')
  })

  it('has accessible Sheet, citation actions, and loading status', () => {
    const sheet = read('features/claim-checker/ui/claim-check-sheet.tsx')
    expect(sheet).toContain('<SheetTitle>')
    expect(sheet).toContain('<SheetDescription>')
    expect(sheet).toContain('aria-live="polite"')
    expect(sheet).toContain('aria-busy={checking}')
    expect(sheet).toContain('View evidence for citation ${source.number}')
    expect(sheet).toContain('Open paper for citation ${source.number}')
    expect(sheet).toContain('w-full')
    expect(sheet).not.toMatch(/min-w-\[(?:\d+)(?:px|rem)\]/)
  })

  it('clears unit assessment components whenever generation starts a new draft', () => {
    const tab = read('features/writer/ui/academic-writer-tab.tsx')
    expect(tab).toMatch(/async function generate\(\)[\s\S]*setResult\(null\)/)
    expect(tab).toMatch(/generating && result\?\.ok/)
  })
})
