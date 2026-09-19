import type { ServerEvidence } from './evidence'
import type { ModelAnswer } from './schemas'
import type { ChatCitation, ChatSegment } from './types'

export type ValidatedAnswer = {
  status: 'answered' | 'insufficient_evidence' | 'out_of_scope'
  segments: ChatSegment[]
  citations: ChatCitation[]
  explanation: string | null
  limitations: string | null
  followUps: string[]
}

/** Server-owned text used when the model gives no explanation. */
const FALLBACK_EXPLANATION = {
  insufficient_evidence:
    'The supplied papers do not contain enough evidence to answer this question.',
  out_of_scope:
    'This question does not appear to relate to the supplied papers.',
} as const

const toCitation = (e: ServerEvidence): ChatCitation => ({
  id: e.id,
  paperId: e.paperId,
  paperTitle: e.paperTitle,
  chunkId: e.chunkId,
  sectionTitle: e.sectionTitle,
  sectionType: e.sectionType,
  pageStart: e.pageStart,
  pageEnd: e.pageEnd,
})

/**
 * Deterministic citation check. The model only ever contributes ids; every returned
 * citation is built from this request's server-held evidence.
 *  - answered: unknown ids removed; a segment left with no valid id is dropped; if no
 *    segment survives, returns null (caller reports answer_unavailable)
 *  - insufficient_evidence / out_of_scope: no segments or citations at all; only a short
 *    bounded explanation (or a fixed server message) is returned
 */
export function validateAnswer(
  answer: ModelAnswer,
  byId: ReadonlyMap<string, ServerEvidence>,
): ValidatedAnswer | null {
  if (answer.status !== 'answered') {
    // Never an answer path: segments, limitations and follow-ups are discarded, so the
    // only model text a client can receive is one short bounded explanation.
    return {
      status: answer.status,
      segments: [],
      citations: [],
      explanation: answer.explanation ?? FALLBACK_EXPLANATION[answer.status],
      limitations: null,
      followUps: [],
    }
  }
  const base = {
    explanation: null,
    limitations: answer.limitations,
    followUps: answer.followUps,
  }

  const segments: ChatSegment[] = []
  const citations = new Map<string, ChatCitation>()
  for (const segment of answer.segments) {
    const valid = [...new Set(segment.citations)].filter((id) => byId.has(id))
    if (valid.length === 0) continue
    segments.push({ text: segment.text, citations: valid })
    for (const id of valid) {
      const evidence = byId.get(id)
      if (evidence && !citations.has(id))
        citations.set(id, toCitation(evidence))
    }
  }
  if (segments.length === 0) return null
  return {
    status: 'answered',
    segments,
    citations: [...citations.values()],
    ...base,
  }
}
