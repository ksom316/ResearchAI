/* eslint-disable @typescript-eslint/no-unnecessary-condition -- Guard malformed runtime input despite the typed API. */
import { compare } from './normalize'
import { deriveGapClaimSignatures } from './signatures'
import { relationships } from './signals'
import { GAP_CLAIM_RULESET_VERSION } from './types'
import type {
  DeriveGapsInput,
  GapCandidate,
  GapClaimFieldKey,
  GapClaimSignature,
  GapTargetFamily,
  GapType,
} from './types'

const RULES = {
  limitations: {
    type: 'recurring_limitation',
    title: 'Potential recurring limitation in this corpus',
  },
  future_work: {
    type: 'future_research_opportunity',
    title: 'Potential future research opportunity in this corpus',
  },
} satisfies Record<
  GapClaimFieldKey,
  { type: GapType; title: string }
>

const evidenceKey = (signature: GapClaimSignature) =>
  JSON.stringify([
    signature.evidenceRef.paperId,
    signature.evidenceRef.fieldKey,
    signature.evidenceRef.itemIndex,
  ])

function uniqueEvidence(signatures: readonly GapClaimSignature[]) {
  const refs = new Map<string, GapClaimSignature['evidenceRef']>()
  for (const signature of signatures) {
    refs.set(evidenceKey(signature), signature.evidenceRef)
  }
  return [...refs.values()].sort(
    (a, b) =>
      compare(a.paperId, b.paperId) ||
      compare(a.fieldKey, b.fieldKey) ||
      a.itemIndex - b.itemIndex,
  )
}

function participatingPaperIds(signatures: readonly GapClaimSignature[]) {
  return [
    ...new Set(signatures.map((signature) => signature.evidenceRef.paperId)),
  ].sort(compare)
}

function addRelatedTerm(candidate: GapCandidate, termId: string) {
  if (!candidate.relatedTermIds.includes(termId)) {
    candidate.relatedTermIds.push(termId)
    candidate.relatedTermIds.sort(compare)
  }
}

/**
 * Pure deterministic V2. Claim signatures apply only to limitations and future work.
 * Every group remains inside one direct typed Research Map relationship; no connected
 * components or transitive paper relationships are constructed. The other three gap
 * types continue to abstain because they have no safe deterministic rule.
 */
export function deriveResearchGaps(input: DeriveGapsInput): GapCandidate[] {
  if (
    !input ||
    !Array.isArray(input.fields) ||
    !Array.isArray(input.researchMap?.nodes) ||
    !Array.isArray(input.researchMap.edges)
  )
    return []

  const signatures = deriveGapClaimSignatures(input)
  const stale = new Set(
    input.researchMap.nodes
      .filter((node) => node?.type === 'paper' && node.isStale)
      .map((node) => (node.type === 'paper' ? node.paperId : '')),
  )
  const candidates = new Map<string, GapCandidate>()

  const createCandidate = (args: {
    signatures: GapClaimSignature[]
    termId: string
    fieldKey: GapClaimFieldKey
    matchKey: string
    description: (paperCount: number) => string
    signal: GapCandidate['signals'][number]
  }) => {
    const paperIds = participatingPaperIds(args.signatures)
    if (paperIds.length < 2) return
    const rule = RULES[args.fieldKey]
    const actionFamily = args.signatures[0].actionFamily
    const id = `gap:v2:${JSON.stringify([
      rule.type,
      GAP_CLAIM_RULESET_VERSION,
      args.fieldKey,
      actionFamily,
      args.matchKey,
      paperIds,
    ])}`
    const existing = candidates.get(id)
    if (existing) {
      addRelatedTerm(existing, args.termId)
      return
    }
    const evidenceRefs = uniqueEvidence(args.signatures)
    candidates.set(id, {
      id,
      type: rule.type,
      title: rule.title,
      description: args.description(paperIds.length),
      paperIds,
      relatedTermIds: [args.termId],
      evidenceRefs,
      supportCount: paperIds.length,
      evidenceCount: evidenceRefs.length,
      isStale: paperIds.some((paperId) => stale.has(paperId)),
      signals: [args.signal],
    })
  }

  for (const { term, paperIds: related } of relationships(input.researchMap)) {
    const inRelationship = signatures.filter((signature) =>
      related.has(signature.evidenceRef.paperId),
    )

    // New signature path: field + action + explicit controlled target.
    const targetGroups = new Map<string, GapClaimSignature[]>()
    for (const signature of inRelationship) {
      for (const targetFamily of signature.targetFamilies) {
        const key = JSON.stringify([
          signature.fieldKey,
          signature.actionFamily,
          targetFamily,
        ])
        targetGroups.set(key, [
          ...(targetGroups.get(key) ?? []),
          signature,
        ])
      }
    }
    for (const [key, group] of targetGroups) {
      const [fieldKey, actionFamily, targetFamily] = JSON.parse(key) as [
        GapClaimFieldKey,
        GapClaimSignature['actionFamily'],
        GapTargetFamily,
      ]
      createCandidate({
        signatures: group,
        termId: term.id,
        fieldKey,
        matchKey: `target:${targetFamily}`,
        description: (paperCount) =>
          `${paperCount} directly related papers express a matching ${
            fieldKey === 'limitations' ? 'limitation' : 'future-work direction'
          } (${actionFamily} / ${targetFamily.replaceAll('_', ' ')}). This is a potential gap in this corpus.`,
        signal: {
          type: 'matching_claim_signatures',
          rulesetVersion: GAP_CLAIM_RULESET_VERSION,
          fieldKey,
          actionFamily,
          targetFamily,
        },
      })
    }

    // Conservative legacy path: exact statement plus the same exact claim-level anchor.
    const exactGroups = new Map<string, GapClaimSignature[]>()
    for (const signature of inRelationship) {
      if (!signature.exactMapAnchorTermIds.includes(term.id)) continue
      const key = JSON.stringify([
        signature.fieldKey,
        signature.actionFamily,
        signature.normalizedStatement,
      ])
      exactGroups.set(key, [...(exactGroups.get(key) ?? []), signature])
    }
    for (const [key, group] of exactGroups) {
      const [fieldKey, , normalizedStatement] = JSON.parse(key) as [
        GapClaimFieldKey,
        GapClaimSignature['actionFamily'],
        string,
      ]
      const sharedTargets = group[0].targetFamilies.filter((target) =>
        group.every((signature) => signature.targetFamilies.includes(target)),
      )
      // The controlled-target path is canonical when both paths describe the same
      // support. Avoid emitting a second candidate for identical evidence.
      if (sharedTargets.length > 0) continue
      createCandidate({
        signatures: group,
        termId: term.id,
        fieldKey,
        matchKey: `statement:${normalizedStatement}`,
        description: (paperCount) =>
          `${paperCount} related papers contain matching explicit ${
            fieldKey === 'limitations' ? 'limitation' : 'future-work'
          } statements: “${normalizedStatement}”. This is a potential gap in this corpus.`,
        signal: {
          type: 'matching_explicit_statements',
          fieldKey,
          statementKey: normalizedStatement,
        },
      })
    }
  }

  for (const candidate of candidates.values()) {
    candidate.relatedTermIds.sort(compare)
    candidate.signals.push(
      ...candidate.relatedTermIds.map((termId) => ({
        type: 'shared_map_term' as const,
        termId,
      })),
    )
  }
  return [...candidates.values()].sort((a, b) => compare(a.id, b.id))
}
