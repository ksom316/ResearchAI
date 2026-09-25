import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createBestEffortServerUsageRecorder,
  createSupabaseUsageRecorder,
} from './recorder.server'

const event = {
  actorUserId: 'actor-id',
  projectId: 'project-id',
  feature: 'research_chat' as const,
  eventType: 'llm_request' as const,
  provider: 'openrouter',
  model: 'openrouter/free',
  idempotencyKey: 'operation:0',
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('trusted usage recording', () => {
  it('writes through the supplied trusted client', async () => {
    const upsert = vi.fn(async () => ({ error: null }))
    const from = vi.fn(() => ({ upsert }))
    const recorder = createSupabaseUsageRecorder({ from } as never)

    await recorder(event)

    expect(from).toHaveBeenCalledWith('usage_events')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: 'actor-id',
        provider: 'openrouter',
        model: 'openrouter/free',
      }),
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    )
  })

  it('logs safe missing variable names once when trusted configuration is absent', async () => {
    vi.stubEnv('SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const recorder = createBestEffortServerUsageRecorder()

    await recorder(event)
    await recorder(event)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[usage]', {
      event: 'usage_recording_failure',
      failureCategory: 'usage_recording',
      cause: 'configuration',
      missingVariables: [
        'SUPABASE_URL or VITE_SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
      ],
    })
  })
})
