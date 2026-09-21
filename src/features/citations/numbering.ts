import type {
  CitationDraftUsage,
  CitationEvidenceIdentity,
  PaperReferenceGroup,
  PaperReferenceNumbering,
} from './types'

/** Assigns one academic number per paper while retaining every evidence identity. */
export function derivePaperReferenceNumbering(
  draft: CitationDraftUsage,
): PaperReferenceNumbering {
  const paperByEvidenceId = new Map(
    draft.citations.map((citation) => [citation.id, citation.paperId]),
  )
  const groups = new Map<string, PaperReferenceGroup>()
  const numberByEvidenceId = new Map<CitationEvidenceIdentity, number>()

  for (const paragraph of draft.paragraphs) {
    for (const unit of paragraph.units) {
      for (const evidenceId of unit.citationIds) {
        const paperId = paperByEvidenceId.get(evidenceId)
        if (!paperId) continue
        let group = groups.get(paperId)
        if (!group) {
          group = {
            paperId,
            number: groups.size + 1,
            evidenceIds: [],
          }
          groups.set(paperId, group)
        }
        if (!group.evidenceIds.includes(evidenceId)) {
          group.evidenceIds.push(evidenceId)
        }
        numberByEvidenceId.set(evidenceId, group.number)
      }
    }
  }

  return {
    references: [...groups.values()],
    numberByPaperId: new Map(
      [...groups.values()].map((group) => [group.paperId, group.number]),
    ),
    numberByEvidenceId,
  }
}

/** Visible academic numbers for one unit, with same-paper evidence collapsed. */
export function referenceNumbersForEvidence(
  evidenceIds: readonly CitationEvidenceIdentity[],
  numbering: PaperReferenceNumbering,
): number[] {
  const seen = new Set<number>()
  const numbers: number[] = []
  for (const evidenceId of evidenceIds) {
    const number = numbering.numberByEvidenceId.get(evidenceId)
    if (number === undefined || seen.has(number)) continue
    seen.add(number)
    numbers.push(number)
  }
  return numbers
}
