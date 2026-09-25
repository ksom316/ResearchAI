import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { wholeMegabytes } from '#/lib/storage/capacity'

export type StorageReservation = {
  id: string
  usedBytes: number
  capacityBytes: number
  remainingBytes: number
}

/** Reserves quota before a storage object is uploaded. The database owns the decision. */
export async function reserveStorageUpload(bytes: number): Promise<StorageReservation> {
  const { data, error } = await getSupabaseBrowserClient().rpc('reserve_storage_upload', { p_bytes: bytes })
  if (error) throw new Error('Storage availability could not be checked.')
  const row = (Array.isArray(data) ? data[0] : data) as {
    allowed: boolean
    reservation_id: string | null
    used_bytes: number
    capacity_bytes: number
    remaining_bytes: number
  }
  if (!row?.allowed || !row.reservation_id) {
    throw new Error(`Not enough storage available. This file needs ${wholeMegabytes(bytes)} MB, but you have ${wholeMegabytes(row?.remaining_bytes ?? 0)} MB remaining.`)
  }
  return {
    id: row.reservation_id,
    usedBytes: row.used_bytes,
    capacityBytes: row.capacity_bytes,
    remainingBytes: row.remaining_bytes,
  }
}

export async function releaseStorageReservation(id: string): Promise<void> {
  await getSupabaseBrowserClient().rpc('release_storage_reservation', { p_reservation_id: id })
}
