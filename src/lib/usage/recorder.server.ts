import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServiceRoleClient } from '#/lib/supabase/supabase.server'
import type { UsageEventInput, UsageRecorder } from './types'

type UsageRow = {
  actor_user_id: string
  project_id: string | null
  feature: string
  event_type: string
  provider: string | null
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  quantity: number
  idempotency_key: string
  metadata: Record<string, string | number | boolean | null>
}

const boundedCount = (value: number | null | undefined): number | null =>
  value === null || value === undefined
    ? null
    : Number.isSafeInteger(value) && value >= 0
      ? value
      : null

export function usageEventRow(event: UsageEventInput): UsageRow {
  return {
    actor_user_id: event.actorUserId,
    project_id: event.projectId,
    feature: event.feature,
    event_type: event.eventType,
    provider: event.provider ?? null,
    model: event.model ?? null,
    input_tokens: boundedCount(event.inputTokens),
    output_tokens: boundedCount(event.outputTokens),
    total_tokens: boundedCount(event.totalTokens),
    quantity: boundedCount(event.quantity ?? 1) ?? 1,
    idempotency_key: event.idempotencyKey ?? crypto.randomUUID(),
    metadata: event.metadata ?? {},
  }
}

/** Trusted server/worker write path. The client must use the service-role key. */
export function createSupabaseUsageRecorder(
  client: SupabaseClient,
): UsageRecorder {
  return async (event) => {
    const { error } = await client
      .from('usage_events')
      .upsert(usageEventRow(event), {
        onConflict: 'idempotency_key',
        ignoreDuplicates: true,
      })
    if (error) throw new Error('Usage event could not be recorded')
  }
}

/** Metering is best effort so a temporary analytics outage does not break AI work. */
export function createBestEffortServerUsageRecorder(): UsageRecorder {
  let recorder: UsageRecorder | null = null
  let warned = false
  return async (event) => {
    try {
      recorder ??= createSupabaseUsageRecorder(createSupabaseServiceRoleClient())
      await recorder(event)
    } catch {
      if (!warned) {
        warned = true
        console.warn('[usage] trusted usage recording is unavailable')
      }
    }
  }
}
