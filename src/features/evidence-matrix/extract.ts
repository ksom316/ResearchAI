import { LlmError } from '#/lib/llm'
import type { LlmProvider, ReasoningConfig } from '#/lib/llm'
import { buildEvidencePacket } from './evidence-packet'
import type { EvidencePacket, PaperInput } from './evidence-packet'
import { FIELD_KEYS } from './fields'
import type { FieldKey } from './fields'
import { buildExtractionUserMessage, EXTRACTION_SYSTEM_PROMPT } from './prompt'
import { EXTRACTION_JSON_SCHEMA, extractionOutputSchema } from './schema'

/**
 * A response that hits this limit fails validation as "truncated" (with the served model
 * logged), not silently. 2000 was tried and truncated a real free-router response
 * (liquid/lfm-2.5-2.6b:free), so it is back at 3000; the prompt now asks for concise items.
 */
export const MAX_EXTRACTION_OUTPUT_TOKENS = 3000
/**
 * Extraction needs no model reasoning, and free-router reasoning models can otherwise
 * spend the whole output budget on reasoning (finish_reason=length). Sent per call only
 * from here; Research Chat sends no reasoning setting. Combined with
 * provider.require_parameters=true, routing only uses endpoints that support it.
 */
export const EVIDENCE_EXTRACTION_REASONING: ReasoningConfig = { effort: 'none' }
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
  /** The provider reported finish_reason=length: the answer was cut off (retryable). */
  | 'truncated'
  | 'invalid_output'
  | 'invalid_citation'

/** Most issues / characters a diagnostic may carry. */
const MAX_DIAGNOSTIC_ISSUES = 5
const MAX_DIAGNOSTIC_CHARS = 300

/** A provider identifier (model slug, finish reason) made log-safe and bounded. */
const identifier = (value: string) =>
  value.replace(/[^A-Za-z0-9_.:/@-]/g, '?').slice(0, 100)

/** A token count as "name=123", only for a real non-negative integer; otherwise omitted. */
const numeric = (name: string, value: number | undefined) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? `${name}=${value}`
    : null

/** A path segment or code made log-safe: schema-shaped tokens only, bounded. */
const token = (value: unknown) =>
  String(value)
    .replace(/[^A-Za-z0-9_]/g, '?')
    .slice(0, 40)

/**
 * A short, CONTENT-FREE description of a failure, for the local worker log only.
 * Built solely from fixed categories, Zod issue paths and codes, evidence ids that
 * already passed the E# pattern, and bounded provider identifiers. Never rejected
 * values, raw model output, or paper/evidence text.
 */
export function safeDiagnostic(parts: {
  category: string
  issues?: readonly { path: readonly PropertyKey[]; code: string }[]
  detail?: string
  model?: string | null
  finishReason?: string | null
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    reasoningTokens?: number
  }
}): string {
  const bits = [parts.category]
  if (parts.issues && parts.issues.length > 0) {
    const shown = parts.issues
      .slice(0, MAX_DIAGNOSTIC_ISSUES)
      .map((i) => `${i.path.map(token).join('.') || '(root)'} ${token(i.code)}`)
    const more = parts.issues.length - shown.length
    bits.push(shown.join(', ') + (more > 0 ? ` (+${more} more)` : ''))
  }
  if (parts.detail) bits.push(parts.detail)
  const meta = [
    parts.model ? `model=${identifier(parts.model)}` : null,
    parts.finishReason ? `finish_reason=${identifier(parts.finishReason)}` : null,
    numeric('prompt_tokens', parts.usage?.promptTokens),
    numeric('completion_tokens', parts.usage?.completionTokens),
    numeric('total_tokens', parts.usage?.totalTokens),
    numeric('reasoning_tokens', parts.usage?.reasoningTokens),
  ].filter(Boolean)
  const text = bits.join(' ') + (meta.length > 0 ? `; ${meta.join('; ')}` : '')
  return text.slice(0, MAX_DIAGNOSTIC_CHARS)
}

export type ExtractionOutcome =
  | {
      ok: true
      /** Null when no evidence existed and no model call was made. */
      provider: string | null
      model: string | null
      fields: NormalizedField[]
      packet: EvidencePacket
    }
  | { ok: false; error: ExtractionErrorCode; diagnostic?: string }

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
  | { ok: false; error: ExtractionErrorCode; diagnostic?: string }

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
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_output',
      diagnostic: safeDiagnostic({
        category: 'schema_validation',
        issues: parsed.error.issues,
      }),
    }
  }

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
        const reason = !evidence
          ? 'unknown_id'
          : !evidence.fields.includes(key)
            ? 'not_eligible_for_field'
            : item.evidence_ids.indexOf(id) !== ord
              ? 'duplicate_id'
              : null
        if (reason !== null) {
          return {
            ok: false,
            error: 'invalid_citation',
            diagnostic: safeDiagnostic({
              category: 'citation',
              detail: `field=${key} item=${itemIndex} ${reason}`,
            }),
          }
        }
        if (!evidence) continue
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
      reasoning: EVIDENCE_EXTRACTION_REASONING,
      signal: deps.signal,
    })
  } catch (error) {
    if (error instanceof LlmError && error.kind === 'invalid_response') {
      return {
        ok: false,
        // ONLY a response the provider itself marked as cut off is retryable. Anything
        // else that was unusable (not JSON, not an object, empty) stays terminal.
        error: error.diagnostic?.category === 'truncated' ? 'truncated' : 'invalid_output',
        diagnostic: safeDiagnostic({
          category: error.diagnostic?.category ?? 'invalid_response',
          model: error.diagnostic?.model,
          finishReason: error.diagnostic?.finishReason,
          usage: error.diagnostic?.usage,
        }),
      }
    }
    return {
      ok: false,
      error: 'llm_unavailable',
      diagnostic:
        error instanceof LlmError ? safeDiagnostic({ category: `llm_${error.kind}` }) : undefined,
    }
  }

  const validated = validateExtraction(result.data, packet)
  if (!validated.ok) {
    // keep the served model / finish reason (bounded identifiers) next to the reason
    const meta = safeDiagnostic({
      category: validated.diagnostic ?? 'validation',
      model: result.model,
      finishReason: result.finishReason,
      usage: result.usage
        ? {
            promptTokens: result.usage.inputTokens ?? undefined,
            completionTokens: result.usage.outputTokens ?? undefined,
            totalTokens: result.usage.totalTokens ?? undefined,
          }
        : undefined,
    })
    return { ...validated, diagnostic: meta }
  }
  return {
    ok: true,
    provider: result.provider,
    model: result.model,
    fields: validated.fields,
    packet,
  }
}
