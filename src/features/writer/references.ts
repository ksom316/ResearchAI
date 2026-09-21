import { derivePaperReferenceNumbering } from '#/features/citations/numbering'
import { normalizePaperCitationMetadata } from '#/features/citations/normalize'
import type { PaperCitationMetadata } from '#/features/citations/types'
import type {
  GroundedDraft,
  GroundedDraftReference,
  ValidatedGroundedDraft,
} from './types'

/** Builds paper-level references only from citations that survived draft validation. */
export function attachGroundedDraftReferences(
  draft: ValidatedGroundedDraft,
  loadedMetadata: readonly PaperCitationMetadata[],
): GroundedDraft {
  const numbering = derivePaperReferenceNumbering(draft)
  const metadataByPaper = new Map(
    loadedMetadata.map((metadata) => [metadata.paperId, metadata]),
  )
  const titleByPaper = new Map(
    draft.citations.map((citation) => [citation.paperId, citation.paperTitle]),
  )
  const references: GroundedDraftReference[] = numbering.references.map(
    (reference) => ({
      number: reference.number,
      paperId: reference.paperId,
      evidenceIds: reference.evidenceIds as GroundedDraftReference['evidenceIds'],
      metadata:
        metadataByPaper.get(reference.paperId) ??
        normalizePaperCitationMetadata({
          paperId: reference.paperId,
          title: titleByPaper.get(reference.paperId) ?? '',
        }),
    }),
  )
  return { ...draft, references }
}

export function citedPaperIds(draft: ValidatedGroundedDraft): string[] {
  return derivePaperReferenceNumbering(draft).references.map(
    (reference) => reference.paperId,
  )
}
