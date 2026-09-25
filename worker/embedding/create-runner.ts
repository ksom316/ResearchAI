import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseUsageRecorder } from '../../src/lib/usage/recorder.server'
import { INPUT_PROFILE_CTX_V1 } from '../../src/lib/embedding/input'
import {
  VOYAGE_PHASE4_PROFILE,
  createVoyageProvider,
} from '../../src/lib/embedding/voyage'
import type { EmbeddingConfig } from '../embedding-config'
import { createSupabaseEmbeddingStore } from './job-store'
import { RateLimiter, paceLimits } from './rate-limiter'
import { EmbeddingJobRunner } from './runner'
import type { Logger } from './runner'
import { TokenEstimator } from './token-estimator'

/** The one profile this worker embeds with (must match the active embedding_models row). */
export const EXPECTED_PROFILE = {
  provider: VOYAGE_PHASE4_PROFILE.provider,
  providerModel: VOYAGE_PHASE4_PROFILE.model,
  dimensions: VOYAGE_PHASE4_PROFILE.dimensions,
  inputProfile: INPUT_PROFILE_CTX_V1,
} as const

/**
 * Wires the real Supabase store, Voyage provider and pacing together.
 *
 * The provider is created with maxAttempts: 1 on purpose: retries are handled by
 * the runner, which knows the 3 requests/minute budget. The client's own quick
 * retries would burn requests and tokens against the limit.
 */
export function createEmbeddingRunner(options: {
  client: SupabaseClient
  config: EmbeddingConfig
  paperId?: string
  log?: Logger
  now?: () => number
}): EmbeddingJobRunner {
  const { client, config, paperId, log } = options
  const now = options.now ?? Date.now
  return new EmbeddingJobRunner({
    store: createSupabaseEmbeddingStore(client, {
      jobMaxAttempts: config.jobMaxAttempts,
      staleAfterMinutes: config.staleAfterMinutes,
    }),
    provider: createVoyageProvider({
      apiKey: config.apiKey,
      batchSize: config.batchSize,
      timeoutMs: config.timeoutMs,
      maxAttempts: 1,
    }),
    limiter: new RateLimiter({
      ...paceLimits({
        requestsPerMinute: config.requestsPerMinute,
        tokensPerMinute: config.tokensPerMinute,
      }),
      now,
    }),
    estimator: new TokenEstimator(),
    now,
    config: {
      jobMaxAttempts: config.jobMaxAttempts,
      maxRequestAttempts: config.maxAttempts,
      maxItemsPerRequest: config.batchSize,
      maxRequestTokens: config.maxRequestTokens,
      expectedProfile: EXPECTED_PROFILE,
    },
    log,
    paperId,
    recordUsage: createSupabaseUsageRecorder(client),
  })
}
