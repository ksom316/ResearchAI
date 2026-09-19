import { createHash } from 'node:crypto'
import { buildDocumentInput } from './input'
import type { DocumentInputFields } from './input'

/**
 * SHA-256 (lowercase hex, 64 chars) of the exact string that is sent to the
 * provider. Stored as chunk_embeddings.content_hash so a later run can tell
 * whether a stored vector still matches its input.
 */
export function contentHash(embeddingInput: string): string {
  return createHash('sha256').update(embeddingInput, 'utf8').digest('hex')
}

/** Convenience: ctx-v1 input and its hash together. */
export function documentInputWithHash(fields: DocumentInputFields): {
  input: string
  hash: string
} {
  const input = buildDocumentInput(fields)
  return { input, hash: contentHash(input) }
}
