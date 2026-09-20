import type { ExtractionField } from '#/features/evidence-matrix/types'
import type { EvidenceRef, ResearchMap } from '#/features/research-map/types'

export const GAP_CLAIM_RULESET_VERSION = 'claim-signature-v1' as const

export type GapClaimFieldKey = 'limitations' | 'future_work'

export type GapActionFamily =
  | 'integrate'
  | 'evaluate'
  | 'build'
  | 'scope_restriction'
  | 'missing_capability'
  | 'inability'
  | 'insufficiency'

export type GapTargetFamily =
  | 'language_model'
  | 'table_structure'
  | 'table_content'

export type GapContextFamily = 'table_recognition_domain'

export type GapClaimSignature = {
  rulesetVersion: typeof GAP_CLAIM_RULESET_VERSION
  fieldKey: GapClaimFieldKey
  actionFamily: GapActionFamily
  targetFamilies: GapTargetFamily[]
  contextFamilies: GapContextFamily[]
  exactMapAnchorTermIds: string[]
  normalizedStatement: string
  evidenceRef: EvidenceRef
}

export type GapType =
  | 'recurring_limitation'
  | 'future_research_opportunity'
  | 'methodology_gap'
  | 'dataset_coverage_gap'
  | 'finding_tension'

export type GapSignal =
  | {
      type: 'matching_explicit_statements'
      fieldKey: 'limitations' | 'future_work'
      statementKey: string
    }
  | {
      type: 'matching_claim_signatures'
      rulesetVersion: typeof GAP_CLAIM_RULESET_VERSION
      fieldKey: GapClaimFieldKey
      actionFamily: GapActionFamily
      targetFamily: GapTargetFamily
    }
  | { type: 'shared_map_term'; termId: string }

/** Potential gaps in this corpus, never assertions about the entire literature. */
export type GapCandidate = {
  id: string
  type: GapType
  title: string
  description: string
  paperIds: string[]
  relatedTermIds: string[]
  /** Whole supporting claims, using the existing lazy provenance contract. */
  evidenceRefs: EvidenceRef[]
  /** Distinct supporting papers, not claims or a confidence score. */
  supportCount: number
  evidenceCount: number
  isStale: boolean
  signals: GapSignal[]
}

/** Supply fields and map from the same loaded corpus snapshot. No source chunks needed. */
export type DeriveGapsInput = {
  fields: readonly ExtractionField[]
  researchMap: Pick<ResearchMap, 'nodes' | 'edges'>
}
