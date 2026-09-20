import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ResearchGapsFilters } from './research-gaps-filters'
import { ResearchGapsSummaryView } from './research-gaps-summary'

describe('Research Gaps UI foundation', () => {
  it('renders compact corpus-relative summary metrics', () => {
    const out = renderToStaticMarkup(
      createElement(ResearchGapsSummaryView, {
        summary: {
          potentialGaps: 1,
          supportingPapers: 2,
          evidenceClaims: 2,
          current: 1,
          stale: 0,
        },
      }),
    )
    expect(out).toContain('Research Gaps')
    expect(out).toContain('Potential gaps')
    expect(out).toContain('Current / stale')
    expect(out).toContain('corpus-relative')
    expect(out).not.toMatch(/confidence|score|proven research gap/iu)
  })

  it('renders only available types and all freshness controls', () => {
    const out = renderToStaticMarkup(
      createElement(ResearchGapsFilters, {
        availableTypes: ['future_research_opportunity'],
        type: 'all',
        status: 'all',
        onTypeChange: vi.fn(),
        onStatusChange: vi.fn(),
      }),
    )
    expect(out).toContain('Future research opportunity')
    expect(out).not.toContain('Methodology gap')
    expect(out).toContain('Current')
    expect(out).toContain('Includes stale evidence')
    expect(out).toContain('aria-label="Filter potential gaps by type"')
  })

  it('registers a real workspace tab without changing overflow containment', () => {
    const tabs = readFileSync(
      'src/features/projects/workspace/tabs.ts',
      'utf8',
    )
    const workspace = readFileSync(
      'src/features/projects/workspace/project-workspace.tsx',
      'utf8',
    )
    expect(tabs).toContain("value: 'research-gaps', label: 'Research Gaps'")
    expect(tabs).toContain("value: 'evidence', label: 'Evidence Matrix'")
    expect(workspace).toContain('<TabsContent value="research-gaps"')
    expect(workspace).toContain(
      '<ResearchGapsTab key={project.id} projectId={project.id} />',
    )
    expect(workspace).toContain('sm:overflow-x-auto')
    expect(workspace).toContain('sm:flex-none')
    expect(workspace).toContain('grid-cols-3')
    expect(workspace).toContain('aria-label="Project workspace"')
  })

  it('keeps cards and evidence layout mobile-safe and provenance lazy', () => {
    const card = readFileSync(
      'src/features/research-gaps/ui/gap-candidate-card.tsx',
      'utf8',
    )
    const sheet = readFileSync(
      'src/features/research-gaps/ui/gap-evidence-sheet.tsx',
      'utf8',
    )
    const tab = readFileSync(
      'src/features/research-gaps/ui/research-gaps-tab.tsx',
      'utf8',
    )
    expect(card).toContain('min-w-0')
    expect(card).toContain('whitespace-normal')
    expect(sheet).toContain('className="w-full')
    expect(sheet).toContain('extractionSourcesForSelection')
    expect(sheet).toContain('<SourceCard')
    expect(tab).toContain('grid-cols-1')
    expect(tab).toContain('selected={selection}')
  })
})
