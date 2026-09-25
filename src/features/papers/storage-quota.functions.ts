import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { logSupabaseRpcError } from '#/lib/supabase/rpc-diagnostics.server'
import {
  authorizePaperUploadForSession,
  reserveStorageUploadForSession,
} from './storage-quota.server'
import type { QuotaClient } from './storage-quota.server'

const requestSchema = z.object({
  bytes: z.number().int().positive(),
})

export const authorizePaperUploadFn = createServerFn({ method: 'POST' })
  .validator(z.object({ projectId: z.string().uuid().nullable() }))
  .handler(({ data }) =>
    authorizePaperUploadForSession(
      createSupabaseServerClient() as unknown as QuotaClient,
      data.projectId,
    ),
  )

export const reserveStorageUploadFn = createServerFn({ method: 'POST' })
  .validator(requestSchema)
  .handler(({ data }) =>
    reserveStorageUploadForSession(
      createSupabaseServerClient() as unknown as QuotaClient,
      data.bytes,
    ),
  )

export const releaseStorageReservationFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }): Promise<void> => {
    const supabase = createSupabaseServerClient()
    const { error } = await supabase.rpc('release_storage_reservation', {
      p_reservation_id: data.id,
    })
    if (error) {
      logSupabaseRpcError({
        operation: 'storage_reservation_release',
        rpc: 'release_storage_reservation',
        error,
      })
    }
  })
