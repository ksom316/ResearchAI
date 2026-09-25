import type { Paper } from '#/features/papers/types'
import { formatNumericDraftCopy } from '#/features/citations/format'
import { allowanceReachedMessage } from '#/lib/usage/presentation'
import { writerRequestSchema } from './schemas'
import type {
  GroundedDraft,
  GroundedDraftCitation,
  NormalizedWriterRequest,
  WriterGenerationErrorCode,
  WriterGenerationResult,
  WriterEvidenceId,
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
    description:
      'Synthesize a focused topic across at least two relevant papers.',
  },
  {
    value: 'compare_studies',
    label: 'Compare studies',
    description:
      'Compare objectives, methods, datasets, and findings across 2–5 papers.',
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
  return new Map(
    draft.references.flatMap((reference) =>
      reference.evidenceIds.map((evidenceId) => [evidenceId, reference.number]),
    ),
  )
}

export function formatDraftForCopy(draft: GroundedDraft): string {
  return formatNumericDraftCopy(
    draft,
    draft.references.map((reference) => reference.metadata),
  )
}

export type UnitPaperCitationGroup = {
  number: number
  paperId: string
  paperTitle: string
  citations: [GroundedDraftCitation, ...GroundedDraftCitation[]]
}

/** Collapses display markers by paper without dropping any evidence citation. */
export function groupUnitCitationsByPaper(
  draft: GroundedDraft,
  citationIds: readonly WriterEvidenceId[],
): UnitPaperCitationGroup[] {
  const numbers = citationNumberMap(draft)
  const citations = new Map(
    draft.citations.map((citation) => [citation.id, citation]),
  )
  const groups = new Map<number, UnitPaperCitationGroup>()
  for (const id of citationIds) {
    const citation = citations.get(id)
    const number = numbers.get(id)
    if (!citation || number === undefined) continue
    const existing = groups.get(number)
    if (existing) existing.citations.push(citation)
    else {
      groups.set(number, {
        number,
        paperId: citation.paperId,
        paperTitle: citation.paperTitle,
        citations: [citation],
      })
    }
  }
  return [...groups.values()]
}

export const WRITER_ERROR_MESSAGES: Record<WriterGenerationErrorCode, string> =
  {
    invalid_request: 'Check the writing mode configuration and try again.',
    unauthenticated:
      'Your session has expired. Sign in again to use Academic Writer.',
    scope_not_found: 'This project or paper selection is no longer available.',
    retrieval_busy: 'Research retrieval is busy. Try again in a moment.',
    retrieval_unavailable:
      'The project evidence could not be loaded right now.',
    writer_busy: 'Academic Writer is busy. Try again in a moment.',
    writer_timeout:
      'Draft generation timed out. No partial draft was displayed.',
    usage_exhausted:
      "You've reached your AI usage allowance for this month. Your allowance resets at the start of next month.",
    writer_unavailable: 'Academic Writer is temporarily unavailable.',
    writer_truncated:
      'The draft was truncated and could not be safely displayed.',
    invalid_output:
      'The generated draft could not be safely verified. Nothing was displayed.',
    invalid_citation:
      'The generated draft could not be safely verified against its sources. Nothing was displayed.',
    invalid_content:
      'The generated draft did not meet the grounded-content requirements. Nothing was displayed.',
  }

export function writerResultMessage(
  result: WriterGenerationResult,
): string | null {
  if (!result.ok)
    return result.error === 'usage_exhausted'
      ? allowanceReachedMessage(result.resetDate)
      : WRITER_ERROR_MESSAGES[result.error]
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
