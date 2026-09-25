import type { LlmUsage } from '#/lib/llm'

export const USAGE_FEATURES = [
  'research_chat',
  'academic_writer',
  'claim_checker',
  'evidence_matrix',
  'research_gaps',
  'semantic_search',
  'paper_processing',
  'embedding_indexing',
] as const

export type UsageFeature = (typeof USAGE_FEATURES)[number]

export const USAGE_EVENT_TYPES = [
  'llm_request',
  'paper_processed',
  'embedding_request',
] as const

export type UsageEventType = (typeof USAGE_EVENT_TYPES)[number]

export type UsageEventInput = {
  actorUserId: string
  projectId: string | null
  feature: UsageFeature
  eventType: UsageEventType
  provider?: string | null
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  quantity?: number
  idempotencyKey?: string
  metadata?: Record<string, string | number | boolean | null>
}

export type UsageRecorder = (event: UsageEventInput) => Promise<void>

export type UsageAllowanceStatus = {
  periodStart: string
  periodEnd: string
  requestsUsed: number
  requestLimit: number
  requestsRemaining: number
  tokensUsed: number
  tokenLimit: number
  tokensRemaining: number
  requestPercent: number
  tokenPercent: number
  percentageUsed: number
  allowed: boolean
  exhaustedReason: 'requests' | 'tokens' | null
}

export type UsageAllowanceChecker = (
  actorUserId: string,
) => Promise<UsageAllowanceStatus>

export class UsageAllowanceExceededError extends Error {
  readonly resetDate: string

  constructor(resetDate: string) {
    super('AI usage allowance reached')
    this.name = 'UsageAllowanceExceededError'
    this.resetDate = resetDate
  }
}

export type UsageAllowanceFailureKind = 'configuration' | 'request' | 'response'

export class UsageAllowanceCheckError extends Error {
  readonly kind: UsageAllowanceFailureKind

  constructor(kind: UsageAllowanceFailureKind) {
    super('AI allowance check is unavailable')
    this.name = 'UsageAllowanceCheckError'
    this.kind = kind
  }
}

export type LlmUsageEvent = UsageEventInput & {
  eventType: 'llm_request'
  usage?: LlmUsage | null
}

export type UsageFeatureBreakdown = {
  feature: UsageFeature
  requests: number
}

export type UsageSummary = {
  month: string
  aiRequests: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  papersProcessed: number
  paperPages: number | null
  embeddingChunks: number
  embeddingRequests: number
  embeddingTokens: number | null
  storageBytes: number | null
  storageCapacityBytes: number | null
  storageRemainingBytes: number | null
  storagePercent: number | null
  allowancePeriodStart: string
  allowancePeriodEnd: string
  aiRequestLimit: number
  aiRequestsRemaining: number
  aiRequestPercent: number
  aiTokenLimit: number
  aiTokensUsed: number
  aiTokensRemaining: number
  aiTokenPercent: number
  aiAllowancePercent: number
  aiAllowanceReached: boolean
  featureBreakdown: UsageFeatureBreakdown[]
}
