import type { PaperSection } from './types'

/** Semantic labels shown next to a section title. 'other' is intentionally omitted. */
const TYPE_LABELS: Partial<Record<string, string>> = {
  abstract: 'Abstract',
  introduction: 'Introduction',
  background: 'Background',
  related_work: 'Related work',
  methods: 'Methods',
  results: 'Results',
  discussion: 'Discussion',
  conclusion: 'Conclusion',
  limitations: 'Limitations',
  references: 'References',
  acknowledgments: 'Acknowledgments',
  appendix: 'Appendix',
}

/** "p. 3" for one page, "pp. 3–5" for a range, or null when pages are unknown. */
export function formatPageRange(
  start: number | null,
  end: number | null,
): string | null {
  const first = start ?? end
  if (first === null) return null
  const last = end ?? start ?? first
  return last > first ? `pp. ${first}–${last}` : `p. ${first}`
}

export type OutlineItem = {
  id: string
  title: string
  /** Semantic type label, or null for generic ('other') sections. */
  typeLabel: string | null
  pages: string | null
}

/**
 * Display model for the document outline. Ordered by `position`, and the type
 * label is dropped when it would only repeat the title (e.g. "Abstract").
 */
export function buildOutline(sections: readonly PaperSection[]): OutlineItem[] {
  return [...sections]
    .sort((a, b) => a.position - b.position)
    .map((section) => {
      const label = TYPE_LABELS[section.section_type] ?? null
      const redundant =
        label !== null &&
        section.title.toLowerCase().replace(/[^a-z]/g, '') ===
          label.toLowerCase().replace(/[^a-z]/g, '')
      return {
        id: section.id,
        title: section.title,
        typeLabel: redundant ? null : label,
        pages: formatPageRange(section.page_start, section.page_end),
      }
    })
}
