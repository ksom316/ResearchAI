import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authorizePaperUploadForSession,
  reserveStorageUploadForSession,
} from './storage-quota.server'

const RESERVATION_ID = '11111111-1111-4111-8111-111111111111'

function client(input?: {
  user?: { id: string } | null
  authError?: { code?: string; message: string } | null
  data?: unknown
  error?: { code?: string; message: string } | null
}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: input?.user === undefined ? { id: 'user-1' } : input.user,
        },
        error: input?.authError ?? null,
      })),
    },
    rpc: vi.fn(async () => ({
      data: Object.prototype.hasOwnProperty.call(input ?? {}, 'data')
        ? input?.data
        : [
            {
              allowed: true,
              reservation_id: RESERVATION_ID,
              used_bytes: 10,
              capacity_bytes: 200,
              remaining_bytes: 170,
            },
          ],
      error: input?.error ?? null,
    })),
  }
}

afterEach(() => vi.restoreAllMocks())

describe('reserveStorageUploadForSession', () => {
  it('uses the authenticated session and exact RPC argument', async () => {
    const supabase = client()
    await expect(reserveStorageUploadForSession(supabase, 20)).resolves.toEqual(
      {
        ok: true,
        reservation: {
          id: RESERVATION_ID,
          usedBytes: 10,
          capacityBytes: 200,
          remainingBytes: 170,
        },
      },
    )
    expect(supabase.auth.getUser).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).toHaveBeenCalledWith('reserve_storage_upload', {
      p_bytes: 20,
    })
  })

  it('does not call the RPC without an authenticated user', async () => {
    const supabase = client({ user: null })
    await expect(reserveStorageUploadForSession(supabase, 20)).resolves.toEqual(
      { ok: false, error: 'unauthenticated' },
    )
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('returns remaining capacity for a quota rejection', async () => {
    const supabase = client({
      data: [
        {
          allowed: false,
          reservation_id: null,
          used_bytes: 190,
          capacity_bytes: 200,
          remaining_bytes: 10,
        },
      ],
    })
    await expect(reserveStorageUploadForSession(supabase, 20)).resolves.toEqual(
      {
        ok: false,
        error: 'quota_exceeded',
        remainingBytes: 10,
      },
    )
  })

  it('logs safe server-side RPC diagnostics but returns only a stable error', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = client({
      error: {
        code: '42702',
        message: 'column reference "capacity_bytes" is ambiguous',
      },
    })
    await expect(reserveStorageUploadForSession(supabase, 20)).resolves.toEqual(
      { ok: false, error: 'unavailable' },
    )
    expect(diagnostic).toHaveBeenCalledWith('[supabase-rpc]', {
      operation: 'storage_reservation',
      rpc: 'reserve_storage_upload',
      code: '42702',
      message: 'column reference "capacity_bytes" is ambiguous',
    })
  })
})

describe('authorizePaperUploadForSession', () => {
  it('allows an authenticated owner to upload to their library', async () => {
    const supabase = client()
    await expect(
      authorizePaperUploadForSession(supabase, null),
    ).resolves.toEqual({ ok: true, actorUserId: 'user-1', role: null })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it.each(['OWNER', 'EDITOR'] as const)(
    'allows a project %s to upload their own paper',
    async (role) => {
      const supabase = client({ data: role })
      await expect(
        authorizePaperUploadForSession(supabase, RESERVATION_ID),
      ).resolves.toEqual({ ok: true, actorUserId: 'user-1', role })
      expect(supabase.rpc).toHaveBeenCalledWith('project_role', {
        p_project_id: RESERVATION_ID,
      })
    },
  )

  it.each([
    ['VIEWER', 'project_forbidden'],
    [null, 'project_forbidden'],
  ] as const)('rejects project role %s', async (role, error) => {
    const supabase = client({ data: role })
    await expect(
      authorizePaperUploadForSession(supabase, RESERVATION_ID),
    ).resolves.toEqual({ ok: false, error })
  })

  it('rejects an unauthenticated library upload', async () => {
    await expect(
      authorizePaperUploadForSession(client({ user: null }), null),
    ).resolves.toEqual({ ok: false, error: 'unauthenticated' })
  })
})
