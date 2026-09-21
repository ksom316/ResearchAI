import { LlmError } from '#/lib/llm'
import type { LlmProvider, ReasoningConfig } from '#/lib/llm'
import {
  logWriterGenerationDiagnostic,
  writerProviderFailureDiagnostic,
  writerResultFailureDiagnostic,
} from './diagnostics.server'
import type { WriterGenerationDiagnostic } from './diagnostics.server'
import { WRITER_DRAFT_JSON_SCHEMA } from './generation-schema'
import { buildWriterUserMessage, WRITER_SYSTEM_PROMPT } from './prompt'
import type {
  WriterAbstentionStatus,
  WriterEvidenceResult,
  WriterGenerationErrorCode,
  WriterGenerationResult,
} from './types'
import { validateWriterDraft } from './validate-draft'

export const MAX_WRITER_OUTPUT_TOKENS = 1_800
export const WRITER_REASONING: ReasoningConfig = { effort: 'none' }

export const WRITER_ABSTENTION_EXPLANATIONS: Record<
  WriterAbstentionStatus,
  string
> = {
  no_evidence:
    'The selected project does not contain usable evidence for this draft.',
  insufficient_evidence:
    'The selected papers do not provide enough evidence to support this draft.',
  stale_only:
    'Only stale evidence is available. Refresh the affected paper intelligence before generating a draft.',
}

export type WriterGenerationDeps = {
  prepareEvidence: (raw: unknown) => Promise<WriterEvidenceResult>
  getLlm: () => LlmProvider
  nonce?: () => string
  signal?: AbortSignal
  diagnosticsEnabled?: boolean
  logDiagnostic?: (diagnostic: WriterGenerationDiagnostic) => void
}

function reportDiagnostic(
  deps: WriterGenerationDeps,
  diagnostic: WriterGenerationDiagnostic,
): void {
  if (deps.logDiagnostic) {
    deps.logDiagnostic(diagnostic)
    return
  }
  logWriterGenerationDiagnostic(diagnostic, deps.diagnosticsEnabled)
}

function providerError(error: unknown): WriterGenerationErrorCode {
  if (!(error instanceof LlmError)) return 'writer_unavailable'
  if (error.kind === 'rate_limited') return 'writer_busy'
  if (error.kind === 'timeout') return 'writer_timeout'
  if (
    error.kind === 'invalid_response' &&
    error.diagnostic?.category === 'truncated'
  ) {
    return 'writer_truncated'
  }
  if (error.kind === 'invalid_response') return 'invalid_output'
  return 'writer_unavailable'
}

/**
 * Browser request -> authorized evidence -> one provider call -> all-or-nothing draft.
 * No evidence or model output is ever accepted from the browser or returned on failure.
 */
export async function generateWriterDraft(
  raw: unknown,
  deps: WriterGenerationDeps,
): Promise<WriterGenerationResult> {
  let prepared: WriterEvidenceResult
  try {
    prepared = await deps.prepareEvidence(raw)
  } catch {
    return { ok: false, error: 'retrieval_unavailable' }
  }
  if (!prepared.ok) return prepared
  if (prepared.status !== 'ready') {
    return {
      ok: true,
      status: prepared.status,
      stage: 'evidence',
      explanation: WRITER_ABSTENTION_EXPLANATIONS[prepared.status],
      request: prepared.request,
      coverage: prepared.coverage,
    }
  }

  let result
  try {
    result = await deps.getLlm().generateStructured({
      system: WRITER_SYSTEM_PROMPT,
      user: buildWriterUserMessage({
        request: prepared.request,
        evidence: prepared.evidence,
        nonce: (deps.nonce ?? (() => globalThis.crypto.randomUUID()))(),
      }),
      schema: WRITER_DRAFT_JSON_SCHEMA,
      maxTokens: MAX_WRITER_OUTPUT_TOKENS,
      reasoning: WRITER_REASONING,
      signal: deps.signal,
    })
  } catch (error) {
    const errorCode = providerError(error)
    reportDiagnostic(
      deps,
      writerProviderFailureDiagnostic(prepared.request.mode, errorCode, error),
    )
    return { ok: false, error: errorCode }
  }

  if (result.finishReason === 'length') {
    reportDiagnostic(
      deps,
      writerResultFailureDiagnostic(
        prepared.request.mode,
        'structured_response',
        'writer_truncated',
        result,
      ),
    )
    return { ok: false, error: 'writer_truncated' }
  }

  const validated = validateWriterDraft(result.data, {
    request: prepared.request,
    evidence: prepared.evidence,
    coverage: prepared.coverage,
  })
  if (!validated.ok) {
    reportDiagnostic(
      deps,
      writerResultFailureDiagnostic(
        prepared.request.mode,
        'validation',
        validated.error,
        result,
      ),
    )
    return validated
  }
  if (validated.status === 'insufficient_evidence') {
    return {
      ok: true,
      status: 'insufficient_evidence',
      stage: 'generation',
      explanation: WRITER_ABSTENTION_EXPLANATIONS.insufficient_evidence,
      request: prepared.request,
      coverage: prepared.coverage,
    }
  }
  return { ok: true, status: 'generated', draft: validated.draft }
}
