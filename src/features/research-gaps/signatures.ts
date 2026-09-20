/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Guard malformed runtime input despite the typed API. */
import { isSpecific } from './normalize'
import { relationships, statements } from './signals'
import {
  ACTION_ALIASES,
  CONTEXT_ALIASES,
  GUARDED_TARGET_ALIASES,
  TARGET_ALIASES,
  containsAlias,
  containsAnyAlias,
} from './vocabulary'
import { GAP_CLAIM_RULESET_VERSION } from './types'
import type {
  DeriveGapsInput,
  GapActionFamily,
  GapClaimSignature,
  GapContextFamily,
  GapTargetFamily,
} from './types'

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const TARGET_FAMILIES = Object.keys(TARGET_ALIASES) as GapTargetFamily[]
const CONTEXT_FAMILIES = Object.keys(CONTEXT_ALIASES) as GapContextFamily[]

/**
 * Pure signature extraction over already-persisted Evidence Matrix fields and the
 * already-derived Research Map. Unsupported or ambiguous claims deliberately abstain.
 */
export function deriveGapClaimSignatures(
  input: DeriveGapsInput,
): GapClaimSignature[] {
  if (
    !input ||
    !Array.isArray(input.fields) ||
    !Array.isArray(input.researchMap?.nodes) ||
    !Array.isArray(input.researchMap.edges)
  )
    return []

  const directRelationships = relationships(input.researchMap)
  const result: GapClaimSignature[] = []

  for (const claim of statements(input.fields)) {
    if (/\b(no|not|never)\b/u.test(claim.key)) continue

    const actionAliases = ACTION_ALIASES[claim.ref.fieldKey]
    const actionFamilies = (
      Object.keys(actionAliases) as GapActionFamily[]
    ).filter((family) =>
      containsAnyAlias(claim.key, actionAliases[family] ?? []),
    )
    if (actionFamilies.length !== 1) continue

    const contextFamilies = CONTEXT_FAMILIES.filter((family) =>
      containsAnyAlias(claim.key, CONTEXT_ALIASES[family]),
    ).sort(compare)

    const targetFamilies = TARGET_FAMILIES.filter((family) => {
      if (containsAnyAlias(claim.key, TARGET_ALIASES[family])) return true
      if (!containsAnyAlias(claim.key, GUARDED_TARGET_ALIASES[family]))
        return false
      return contextFamilies.includes('table_recognition_domain')
    }).sort(compare)

    const exactMapAnchorTermIds = [
      ...new Set(
        directRelationships
          .filter(
            ({ term, paperIds }) =>
              paperIds.has(claim.ref.paperId) &&
              containsAlias(claim.key, term.key) &&
              isSpecific(claim.key, term.key),
          )
          .map(({ term }) => term.id),
      ),
    ].sort(compare)

    if (targetFamilies.length === 0 && exactMapAnchorTermIds.length === 0)
      continue

    result.push({
      rulesetVersion: GAP_CLAIM_RULESET_VERSION,
      fieldKey: claim.ref.fieldKey,
      actionFamily: actionFamilies[0],
      targetFamilies,
      contextFamilies,
      exactMapAnchorTermIds,
      normalizedStatement: claim.key,
      evidenceRef: claim.ref,
    })
  }

  return result.sort(
    (a, b) =>
      compare(a.evidenceRef.paperId, b.evidenceRef.paperId) ||
      compare(a.fieldKey, b.fieldKey) ||
      a.evidenceRef.itemIndex - b.evidenceRef.itemIndex,
  )
}
