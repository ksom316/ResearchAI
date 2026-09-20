import type { TermNode } from '#/features/research-map/types'
import type {
  GapActionFamily,
  GapCandidate,
  GapClaimFieldKey,
  GapSignal,
  GapTargetFamily,
  GapType,
} from './types'

export const GAP_TYPE_LABELS: Record<GapType, string> = {
  recurring_limitation: 'Recurring limitation',
  future_research_opportunity: 'Future research opportunity',
  methodology_gap: 'Methodology gap',
  dataset_coverage_gap: 'Dataset coverage gap',
  finding_tension: 'Finding tension',
}

export const GAP_ACTION_LABELS: Record<GapActionFamily, string> = {
  integrate: 'Integration',
  evaluate: 'Evaluation',
  build: 'Build',
  scope_restriction: 'Scope restriction',
  missing_capability: 'Missing capability',
  inability: 'Inability',
  insufficiency: 'Insufficiency',
}

export const GAP_TARGET_LABELS: Record<GapTargetFamily, string> = {
  language_model: 'Language model',
  table_structure: 'Table structure',
  table_content: 'Table content',
}

const TARGET_HEADING_LABELS: Record<GapTargetFamily, string> = {
  language_model: 'Language-model',
  table_structure: 'Table-structure',
  table_content: 'Table-content',
}

const TARGET_EXPLANATION_LABELS: Record<GapTargetFamily, string> = {
  language_model: 'language models',
  table_structure: 'table structure',
  table_content: 'table content',
}

const FIELD_DIRECTION_LABELS: Record<GapClaimFieldKey, string> = {
  limitations: 'limitation',
  future_work: 'future-work direction',
}

export function gapTypeLabel(type: GapType): string {
  return GAP_TYPE_LABELS[type]
}

export function gapDisplayHeading(candidate: GapCandidate): string {
  const signal = candidate.signals.find(
    (item): item is Extract<GapSignal, { type: 'matching_claim_signatures' }> =>
      item.type === 'matching_claim_signatures',
  )
  if (!signal) return candidate.title
  return `${TARGET_HEADING_LABELS[signal.targetFamily]} ${GAP_ACTION_LABELS[
    signal.actionFamily
  ].toLowerCase()}`
}

export function explainGapSignals(
  candidate: GapCandidate,
  terms: ReadonlyMap<string, Pick<TermNode, 'label'>>,
): string[] {
  return candidate.signals.flatMap((signal) => {
    if (signal.type === 'matching_claim_signatures') {
      return [
        `These directly related papers describe a matching ${
          FIELD_DIRECTION_LABELS[signal.fieldKey]
        } involving ${GAP_ACTION_LABELS[signal.actionFamily].toLowerCase()} and ${
          TARGET_EXPLANATION_LABELS[signal.targetFamily]
        }.`,
      ]
    }
    if (signal.type === 'matching_explicit_statements') {
      return [
        `These directly related papers contain the same explicit ${
          FIELD_DIRECTION_LABELS[signal.fieldKey]
        } statement.`,
      ]
    }
    const label = terms.get(signal.termId)?.label
    return [`Research Map relationship: ${label || 'Related corpus term'}`]
  })
}
