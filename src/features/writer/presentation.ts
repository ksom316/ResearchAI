import type { Paper } from '#/features/papers/types'
import { writerRequestSchema } from './schemas'
import type {
  GroundedDraft,
  NormalizedWriterRequest,
  WriterGenerationErrorCode,
  WriterGenerationResult,
  WriterMode,
} from './types'

export type WriterModeOption = {
  value: WriterMode
  label: string
  description: string
}

export const WRITER_MODE_OPTIONS: readonly WriterModeOption[] = [
  {
    value: 'literature_synthesis',
    label: 'Literature synthesis',
    description: 'Synthesize a focused topic across at least two relevant papers.',
  },
  {
    value: 'compare_studies',
    label: 'Compare studies',
    description: 'Compare objectives, methods, datasets, and findings across 2–5 papers.',
  },
  {
    value: 'methodology_summary',
    label: 'Methodology summary',
    description: 'Summarize source-backed methodologies and datasets.',
  },
  {
    value: 'findings_synthesis',
    label: 'Findings synthesis',
    description: 'Synthesize source-backed findings from multiple papers.',
  },
  {
    value: 'limitations_future_work',
    label: 'Limitations & future work',
    description: 'Synthesize reported limitations and future-work directions.',
  },
] as const

export type WriterFormState = {
  mode: WriterMode
  focus: string
  paperIds: string[]
}

export function buildWriterRequest(
  projectId: string,
  form: WriterFormState,
): NormalizedWriterRequest | null {
  const paperIds = [...new Set(form.paperIds)].sort()
  const raw =
    form.mode === 'literature_synthesis'
      ? { projectId, mode: form.mode, focus: form.focus }
      : form.mode === 'compare_studies'
        ? { projectId, mode: form.mode, paperIds }
        : paperIds.length > 0
          ? { projectId, mode: form.mode, paperIds }
          : { projectId, mode: form.mode }
  const parsed = writerRequestSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function toggleWriterPaper(
  selected: readonly string[],
  paperId: string,
  max = 5,
): string[] {
  if (selected.includes(paperId)) return selected.filter((id) => id !== paperId)
  if (selected.length >= max) return [...selected]
  return [...selected, paperId]
}

export function citationNumberMap(draft: GroundedDraft): Map<string, number> {
  return new Map(draft.citations.map((citation, index) => [citation.id, index + 1]))
}

export function formatDraftForCopy(draft: GroundedDraft): string {
  const numbers = citationNumberMap(draft)
  return draft.paragraphs
    .map((paragraph) =>
      paragraph.units
        .map((unit) => {
          const citations = unit.citationIds
            .map((id) => numbers.get(id))
            .filter((value): value is number => value !== undefined)
            .map((value) => `[${value}]`)
            .join(' ')
          return `${unit.text}${citations ? ` ${citations}` : ''}`
        })
        .join(' '),
    )
    .join('\n\n')
}

export const WRITER_ERROR_MESSAGES: Record<WriterGenerationErrorCode, string> = {
  invalid_request: 'Check the writing mode configuration and try again.',
  unauthenticated: 'Your session has expired. Sign in again to use Academic Writer.',
  scope_not_found: 'This project or paper selection is no longer available.',
  retrieval_busy: 'Research retrieval is busy. Try again in a moment.',
  retrieval_unavailable: 'The project evidence could not be loaded right now.',
  writer_busy: 'Academic Writer is busy. Try again in a moment.',
  writer_timeout: 'Draft generation timed out. No partial draft was displayed.',
  writer_unavailable: 'Academic Writer is temporarily unavailable.',
  writer_truncated: 'The draft was truncated and could not be safely displayed.',
  invalid_output:
    'The generated draft could not be safely verified. Nothing was displayed.',
  invalid_citation:
    'The generated draft could not be safely verified against its sources. Nothing was displayed.',
  invalid_content:
    'The generated draft did not meet the grounded-content requirements. Nothing was displayed.',
}

export function writerResultMessage(result: WriterGenerationResult): string | null {
  if (!result.ok) return WRITER_ERROR_MESSAGES[result.error]
  if (result.status === 'generated') return null
  if (result.status === 'no_evidence')
    return 'No usable source-backed evidence is available for this writing mode.'
  if (result.status === 'stale_only')
    return 'The available research intelligence is out of date. Refresh the affected paper intelligence before generating this draft.'
  return 'The project does not yet contain enough supporting evidence for this draft.'
}

export function paperTitleById(
  papers: readonly Pick<Paper, 'id' | 'title'>[],
): Map<string, string> {
  return new Map(papers.map((paper) => [paper.id, paper.title]))
}
