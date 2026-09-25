import { LlmError } from '#/lib/llm'
import type {
  LlmProvider,
  StructuredRequest,
  StructuredResult,
} from '#/lib/llm'
import { UsageAllowanceExceededError } from './types'
import type {
  UsageAllowanceChecker,
  UsageRecorder,
  UsageFeature,
} from './types'

export type MeteredLlmOptions = {
  actorUserId: string | null
  projectId: string | null
  feature: Extract<
    UsageFeature,
    | 'research_chat'
    | 'academic_writer'
    | 'claim_checker'
    | 'evidence_matrix'
    | 'research_gaps'
  >
  recordUsage: UsageRecorder
  checkAllowance?: UsageAllowanceChecker
  /** Stable operation prefix for worker retries; each provider invocation gets a suffix. */
  operationKey?: string
}

const errorUsage = (error: unknown) =>
  error instanceof LlmError && error.diagnostic?.usage
    ? {
        inputTokens: error.diagnostic.usage.promptTokens ?? null,
        outputTokens: error.diagnostic.usage.completionTokens ?? null,
        totalTokens: error.diagnostic.usage.totalTokens ?? null,
      }
    : null

/** Adds one trusted append-only event around the shared structured LLM provider. */
export function createMeteredLlm(
  provider: LlmProvider,
  options: MeteredLlmOptions,
): LlmProvider {
  let invocation = 0
  const record = async (
    result: StructuredResult | null,
    error: unknown,
  ): Promise<void> => {
    if (!options.actorUserId) return
    const usage = result?.usage ?? errorUsage(error)
    await options.recordUsage({
      actorUserId: options.actorUserId,
      projectId: options.projectId,
      feature: options.feature,
      eventType: 'llm_request',
      provider: result?.provider ?? provider.providerName ?? 'openrouter',
      model:
        result?.model ??
        (error instanceof LlmError ? error.diagnostic?.model : null) ??
        provider.modelName ??
        null,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      quantity: 1,
      idempotencyKey: `${options.operationKey ?? crypto.randomUUID()}:${invocation++}`,
      metadata: {
        outcome: result ? 'success' : 'failure',
        ...(result?.finishReason ? { finish_reason: result.finishReason } : {}),
      },
    })
  }

  return {
    providerName: provider.providerName,
    modelName: provider.modelName,
    async generateStructured(request: StructuredRequest) {
      if (!options.actorUserId) {
        throw new LlmError('auth', 'Authentication is required')
      }
      if (options.checkAllowance) {
        const allowance = await options.checkAllowance(options.actorUserId)
        if (!allowance.allowed) {
          throw new UsageAllowanceExceededError(allowance.periodEnd)
        }
      }
      try {
        const result = await provider.generateStructured(request)
        await record(result, null).catch(() => undefined)
        return result
      } catch (error) {
        await record(null, error).catch(() => undefined)
        throw error
      }
    },
  }
}
