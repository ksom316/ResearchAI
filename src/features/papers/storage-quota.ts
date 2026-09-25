import { wholeMegabytes } from '#/lib/storage/capacity'
import {
  authorizePaperUploadFn,
  releaseStorageReservationFn,
  reserveStorageUploadFn,
} from './storage-quota.functions'

export type StorageReservation = {
  id: string
  usedBytes: number
  capacityBytes: number
  remainingBytes: number
}

export async function authorizePaperUpload(
  projectId: string | null,
): Promise<string> {
  const result = await authorizePaperUploadFn({ data: { projectId } })
  if (result.ok) return result.actorUserId
  if (result.error === 'unauthenticated') {
    throw new Error('Your session has expired. Please sign in again.')
  }
  if (result.error === 'project_forbidden') {
    throw new Error('You need Editor access to upload to this project.')
  }
  throw new Error('Project access could not be checked.')
}

/** Reserves quota before a storage object is uploaded. The database owns the decision. */
export async function reserveStorageUpload(
  bytes: number,
): Promise<StorageReservation> {
  const result = await reserveStorageUploadFn({ data: { bytes } })
  if (!result.ok) {
    if (result.error === 'unauthenticated') {
      throw new Error('Your session has expired. Please sign in again.')
    }
    if (result.error === 'quota_exceeded') {
      throw new Error(
        `Not enough storage available. This file needs ${wholeMegabytes(bytes)} MB, but you have ${wholeMegabytes(result.remainingBytes ?? 0)} MB remaining.`,
      )
    }
    throw new Error('Storage availability could not be checked.')
  }
  return result.reservation
}

export async function releaseStorageReservation(id: string): Promise<void> {
  await releaseStorageReservationFn({ data: { id } })
}
