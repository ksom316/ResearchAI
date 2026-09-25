import { z } from 'zod'
import { logSupabaseRpcError } from '#/lib/supabase/rpc-diagnostics.server'

const reservationRow = z.object({
  allowed: z.boolean(),
  reservation_id: z.string().uuid().nullable(),
  used_bytes: z.coerce.number().int().min(0),
  capacity_bytes: z.coerce.number().int().positive(),
  remaining_bytes: z.coerce.number().int().min(0),
})

export type StorageReservationOutcome =
  | {
      ok: true
      reservation: {
        id: string
        usedBytes: number
        capacityBytes: number
        remainingBytes: number
      }
    }
  | {
      ok: false
      error: 'unauthenticated' | 'quota_exceeded' | 'unavailable'
      remainingBytes?: number
    }

export type QuotaClient = {
  auth: {
    getUser: () => Promise<{
      data: { user: { id: string } | null }
      error: { code?: string; message: string } | null
    }>
  }
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: unknown
    error: { code?: string; message: string } | null
  }>
}

export type PaperUploadAuthorizationOutcome =
  | { ok: true; actorUserId: string; role: 'OWNER' | 'EDITOR' | null }
  | {
      ok: false
      error: 'unauthenticated' | 'project_forbidden' | 'unavailable'
    }

export async function authorizePaperUploadForSession(
  client: QuotaClient,
  projectId: string | null,
): Promise<PaperUploadAuthorizationOutcome> {
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError) {
    logSupabaseRpcError({
      operation: 'paper_upload_session',
      rpc: 'auth.getUser',
      error: userError,
    })
  }
  if (!userData.user) return { ok: false, error: 'unauthenticated' }
  if (!projectId) {
    return { ok: true, actorUserId: userData.user.id, role: null }
  }

  const { data: role, error } = await client.rpc('project_role', {
    p_project_id: projectId,
  })
  if (error) {
    logSupabaseRpcError({
      operation: 'paper_upload_authorization',
      rpc: 'project_role',
      error,
    })
    return { ok: false, error: 'unavailable' }
  }
  if (role !== 'OWNER' && role !== 'EDITOR') {
    return { ok: false, error: 'project_forbidden' }
  }
  return { ok: true, actorUserId: userData.user.id, role }
}

export async function reserveStorageUploadForSession(
  client: QuotaClient,
  bytes: number,
): Promise<StorageReservationOutcome> {
  const { data: userData, error: userError } = await client.auth.getUser()
  if (userError) {
    logSupabaseRpcError({
      operation: 'storage_session',
      rpc: 'auth.getUser',
      error: userError,
    })
  }
  if (!userData.user) return { ok: false, error: 'unauthenticated' }

  const { data, error } = await client.rpc('reserve_storage_upload', {
    p_bytes: bytes,
  })
  if (error) {
    logSupabaseRpcError({
      operation: 'storage_reservation',
      rpc: 'reserve_storage_upload',
      error,
    })
    return { ok: false, error: 'unavailable' }
  }

  const parsed = reservationRow.safeParse(Array.isArray(data) ? data[0] : data)
  if (!parsed.success) {
    logSupabaseRpcError({
      operation: 'storage_reservation',
      rpc: 'reserve_storage_upload',
      error: { code: 'invalid_response', message: 'Database request failed' },
    })
    return { ok: false, error: 'unavailable' }
  }
  const row = parsed.data
  if (!row.allowed || !row.reservation_id) {
    return {
      ok: false,
      error: 'quota_exceeded',
      remainingBytes: row.remaining_bytes,
    }
  }
  return {
    ok: true,
    reservation: {
      id: row.reservation_id,
      usedBytes: row.used_bytes,
      capacityBytes: row.capacity_bytes,
      remainingBytes: row.remaining_bytes,
    },
  }
}
