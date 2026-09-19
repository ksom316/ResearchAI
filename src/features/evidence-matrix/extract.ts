import { LlmError } from '#/lib/llm'
import type { LlmProvider } from '#/lib/llm'
import { buildEvidencePacket } from './evidence-packet'
import type { EvidencePacket, PaperInput } from './evidence-packet'
import { FIELD_KEYS } from './fields'
import type { FieldKey } from './fields'
import { buildExtractionUserMessage, EXTRACTION_SYSTEM_PROMPT } from './prompt'
import { EXTRACTION_JSON_SCHEMA, extractionOutputSchema } from './schema'

export const MAX_EXTRACTION_OUTPUT_TOKENS = 3000
/** paper_extraction_sources.excerpt allows at most 400 characters. */
export const MAX_EXCERPT_CHARS = 400

/** One source, shaped for store_extraction_field's p_sources (snake_case keys). */
export type SourceRef = {
  item_index: number
  ord: number
  chunk_id: string
  /** Deterministic verbatim substring of the cited chunk; never model-written. */
  excerpt: string
}

export type NormalizedField = {
  fieldKey: FieldKey
  state: 'extracted' | 'not_reported'
  /** p_value for store_extraction_field: {"items": [{"text": ...}]}. */
  value: { items: { text: string }[] }
  sources: SourceRef[]
}

export type ExtractionErrorCode =
  | 'llm_unavailable'
  | 'invalid_output'
  | 'invalid_citation'

export type ExtractionOutcome =
  | {
      ok: true
      /** Null when no evidence existed and no model call was made. */
      provider: string | null
      model: string | null
      fields: NormalizedField[]
      packet: EvidencePacket
    }
  | { ok: false; error: ExtractionErrorCode }

/**
 * Deterministic verbatim excerpt: the start of the chunk (leading whitespace skipped),
 * at most MAX_EXCERPT_CHARS, cut at a space when that keeps at least half the budget.
 * Always a `text.slice(...)`, so it is a substring of the chunk.
 */
export function deriveExcerpt(text: string): string {
  const start = text.search(/\S/)
  if (start < 0) return ''
  let end = Math.min(text.length, start + MAX_EXCERPT_CHARS)
  if (end < text.length) {
    const lastSpace = text.lastIndexOf(' ', end)
    if (lastSpace - start >= MAX_EXCERPT_CHARS / 2) end = lastSpace
    const code = text.charCodeAt(end - 1)
    if (code >= 0xd800 && code <= 0xdbff) end -= 1 // never split a surrogate pair
  }
  return text.slice(start, end).trimEnd()
}

const notReported = (fieldKey: FieldKey): NormalizedField => ({
  fieldKey,
  state: 'not_reported',
  value: { items: [] },
  sources: [],
})

type Validation =
  | { ok: true; fields: NormalizedField[] }
  | { ok: false; error: ExtractionErrorCode }

/**
 * Zod-parse, then validate every citation against the packet. Nothing is repaired:
 * a malformed field, an unknown or duplicate id, or an id not eligible for its field
 * fails the whole result.
 */
export function validateExtraction(
  data: unknown,
  packet: EvidencePacket,
): Validation {
  const parsed = extractionOutputSchema.safeParse(data)
  if (!parsed.success) return { ok: false, error: 'invalid_output' }

  const fields: NormalizedField[] = []
  for (const key of FIELD_KEYS) {
    const field = parsed.data.fields[key]
    if (field.state === 'not_reported') {
      fields.push(notReported(key))
      continue
    }
    const sources: SourceRef[] = []
    for (const [itemIndex, item] of field.items.entries()) {
      for (const [ord, id] of item.evidence_ids.entries()) {
        const evidence = packet.byId.get(id)
        if (
          !evidence ||
          !evidence.fields.includes(key) ||
          item.evidence_ids.indexOf(id) !== ord
        ) {
          return { ok: false, error: 'invalid_citation' }
        }
        sources.push({
          item_index: itemIndex,
          ord,
          chunk_id: evidence.chunkId,
          excerpt: deriveExcerpt(evidence.text),
        })
      }
    }
    fields.push({
      fieldKey: key,
      state: 'extracted',
      value: { items: field.items.map((i) => ({ text: i.text })) },
      sources,
    })
  }
  return { ok: true, fields }
}

export type ExtractionDeps = {
  /** Called only when evidence exists. Tests pass a fake provider. */
  getLlm: () => LlmProvider
  /** Per-request delimiter nonce; injectable for tests. */
  nonce?: () => string
  signal?: AbortSignal
}

/**
 * paper -> deterministic evidence packet -> ONE structured LLM call -> zod ->
 * citation validation -> normalized fields. No database, no retries, no fallbacks.
 * Persistence (6A.3) passes each field's key/state/value/sources to
 * store_extraction_field.
 */
export async function extractEvidenceMatrix(
  paper: PaperInput,
  deps: ExtractionDeps,
): Promise<ExtractionOutcome> {
  const packet = buildEvidencePacket(paper)
  if (packet.items.length === 0) {
    return {
      ok: true,
      provider: null,
      model: null,
      fields: FIELD_KEYS.map(notReported),
      packet,
    }
  }

  let result
  try {
    result = await deps.getLlm().generateStructured({
      system: EXTRACTION_SYSTEM_PROMPT,
      user: buildExtractionUserMessage(
        packet,
        (deps.nonce ?? (() => globalThis.crypto.randomUUID()))(),
      ),
      schema: EXTRACTION_JSON_SCHEMA,
      maxTokens: MAX_EXTRACTION_OUTPUT_TOKENS,
      signal: deps.signal,
    })
  } catch (error) {
    if (error instanceof LlmError && error.kind === 'invalid_response') {
      return { ok: false, error: 'invalid_output' }
    }
    return { ok: false, error: 'llm_unavailable' }
  }

  const validated = validateExtraction(result.data, packet)
  if (!validated.ok) return validated
  return {
    ok: true,
    provider: result.provider,
    model: result.model,
    fields: validated.fields,
    packet,
  }
}
