import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { getSupabaseEnv } from '#/lib/supabase/env'
import { PDF_MIME } from './validation'

export const PAPERS_BUCKET = 'papers'

/** Uploads to the private bucket via XHR so we can report real progress. */
export async function uploadObject(
  path: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const { url, anonKey } = getSupabaseEnv()
  const { data } = await getSupabaseBrowserClient().auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Your session has expired. Please sign in again.')

  const objectUrl = `${url}/storage/v1/object/${PAPERS_BUCKET}/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', objectUrl)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', anonKey)
    xhr.setRequestHeader('Content-Type', PDF_MIME)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve()
      let message = `Upload failed (${xhr.status}).`
      try {
        const body = JSON.parse(xhr.responseText) as { message?: string }
        if (body.message) message = body.message
      } catch {
        // keep generic message
      }
      reject(new Error(message))
    }
    xhr.onerror = () =>
      reject(new Error('Network error while uploading. Please try again.'))
    xhr.onabort = () => reject(new Error('Upload cancelled.'))
    xhr.send(file)
  })
}

export async function removeObject(path: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient()
    .storage.from(PAPERS_BUCKET)
    .remove([path])
  if (error) throw error
}

/** Short-lived signed URL for a private object. */
export async function getSignedUrl(path: string): Promise<string> {
  const { data, error } = await getSupabaseBrowserClient()
    .storage.from(PAPERS_BUCKET)
    .createSignedUrl(path, 120)
  if (error) throw error
  return data.signedUrl
}
