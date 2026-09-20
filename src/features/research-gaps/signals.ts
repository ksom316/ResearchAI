/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Persisted input may be malformed at runtime. */
import type { ExtractionField } from '#/features/evidence-matrix/types'
import type { EvidenceRef, TermNode } from '#/features/research-map/types'
import { compare, statementKey } from './normalize'
import type { DeriveGapsInput, GapClaimFieldKey } from './types'

export type Statement = {
  key: string
  ref: EvidenceRef & { fieldKey: GapClaimFieldKey }
}

/**
 * Duplicate persisted rows: latest revision wins; conflicting equal revisions are
 * unusable. Never fall back to older positive evidence after a newer missing field.
 * Any malformed item invalidates the entire field so item indexes remain trustworthy.
 */
export function statements(fields: DeriveGapsInput['fields']): Statement[] {
  const groups = new Map<string, ExtractionField[]>()
  for (const field of fields) {
    if (
      !field ||
      typeof field.paperId !== 'string' ||
      typeof field.updatedAt !== 'string'
    )
      continue
    if (field.fieldKey !== 'limitations' && field.fieldKey !== 'future_work')
      continue
    const key = JSON.stringify([field.paperId, field.fieldKey])
    groups.set(key, [...(groups.get(key) ?? []), field])
  }
  const result: Statement[] = []
  for (const rows of groups.values()) {
    const newest = rows
      .map((row) => row.updatedAt)
      .sort(compare)
      .at(-1)
    const latest = rows.filter((row) => row.updatedAt === newest)
    const signatures = new Set(
      latest.map((row) =>
        JSON.stringify([
          row.schemaVersion,
          row.state,
          row.itemsMalformed,
          row.items,
        ]),
      ),
    )
    if (signatures.size !== 1) continue
    const field = latest[0]
    if (
      field.state !== 'extracted' ||
      field.itemsMalformed ||
      !Array.isArray(field.items) ||
      (field.fieldKey !== 'limitations' && field.fieldKey !== 'future_work')
    )
      continue
    if (field.items.some((item) => !item || typeof item.text !== 'string'))
      continue
    const fieldKey = field.fieldKey
    field.items.forEach((item, itemIndex) => {
      const key = statementKey(item.text)
      if (key)
        result.push({
          key,
          ref: {
            paperId: field.paperId,
            fieldKey,
            itemIndex,
            matchedPhrase: null,
          },
        })
    })
  }
  return result
}

/** Only direct, typed edges to the same term count; no transitive relatedness. */
export function relationships(map: DeriveGapsInput['researchMap']): {
  term: TermNode
  paperIds: Set<string>
}[] {
  const papers = new Map(
    map.nodes
      .filter((node) => node?.type === 'paper')
      .map((node) => [node.id, node.paperId]),
  )
  const edgeTypes = {
    concept: 'paper_has_concept',
    methodology: 'paper_uses_methodology',
    dataset: 'paper_uses_dataset',
  }
  return map.nodes
    .filter((node): node is TermNode => node?.type === 'term')
    .flatMap((term) => {
      if (
        typeof term.id !== 'string' ||
        typeof term.key !== 'string' ||
        !Array.isArray(term.paperIds)
      )
        return []
      const paperIds = new Set<string>()
      for (const edge of map.edges) {
        if (!edge || edge.to !== term.id || edge.type !== edgeTypes[term.kind])
          continue
        const paperId = papers.get(edge.from)
        if (typeof paperId !== 'string' || !term.paperIds.includes(paperId))
          continue
        const fieldKey = term.kind === 'concept' ? 'concepts' : term.kind
        if (
          !Array.isArray(edge.evidence) ||
          !edge.evidence.some(
            (ref) =>
              ref?.paperId === paperId &&
              ref.fieldKey === fieldKey &&
              Number.isInteger(ref.itemIndex) &&
              ref.itemIndex >= 0,
          )
        )
          continue
        paperIds.add(paperId)
      }
      return paperIds.size >= 2 ? [{ term, paperIds }] : []
    })
}
