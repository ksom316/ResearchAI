import { contentHash } from '../../src/lib/embedding/hash'
import { buildDocumentInput } from '../../src/lib/embedding/input'
import type { PaperChunkSnapshot } from './types'

/** A chunk that still needs an embedding, with its exact ctx-v1 input. */
export type PlannedChunk = {
  chunkId: string
  index: number
  input: string
  hash: string
  chars: number
}

export type EmbeddingPlan = {
  total: number
  /** Stored embeddings whose content_hash matches today's ctx-v1 input: reused. */
  reused: number
  /** Missing, or stored with a different hash (stale): must be (re)embedded. */
  pending: PlannedChunk[]
}

/** Thrown when a chunk cannot produce a valid embedding input (never retryable). */
export class InvalidChunkError extends Error {
  constructor() {
    super('A chunk has no text to embed')
    this.name = 'InvalidChunkError'
  }
}

/**
 * Builds the ctx-v1 input for every chunk in deterministic chunk_index order and
 * decides which need embedding. A stored embedding is reused ONLY if its
 * content_hash equals the hash of the exact current input; a missing hash or a
 * mismatch means the chunk is embedded again, never silently reused.
 */
export function planChunks(snapshot: PaperChunkSnapshot): EmbeddingPlan {
  const ordered = [...snapshot.chunks].sort((a, b) => a.index - b.index)
  const pending: PlannedChunk[] = []
  let reused = 0

  for (const chunk of ordered) {
    let input: string
    try {
      input = buildDocumentInput({
        paperTitle: snapshot.paperTitle,
        sectionTitle: chunk.sectionTitle,
        text: chunk.text,
      })
    } catch {
      throw new InvalidChunkError()
    }
    const hash = contentHash(input)
    if (snapshot.existingHashes.get(chunk.id) === hash) {
      reused++
    } else {
      pending.push({
        chunkId: chunk.id,
        index: chunk.index,
        input,
        hash,
        chars: input.length,
      })
    }
  }
  return { total: ordered.length, reused, pending }
}

/**
 * Takes the next request's worth of chunks from the front of `pending`, keeping
 * order: at most `maxItems` chunks and (except for a single oversized chunk)
 * at most `maxTokens` estimated tokens. Always takes at least one.
 */
export function takeBatch(
  pending: readonly PlannedChunk[],
  limits: { maxItems: number; maxTokens: number },
  estimate: (chars: number) => number,
): PlannedChunk[] {
  const batch: PlannedChunk[] = []
  let tokens = 0
  for (const chunk of pending) {
    const next = estimate(chunk.chars)
    if (
      batch.length > 0 &&
      (batch.length >= limits.maxItems || tokens + next > limits.maxTokens)
    ) {
      break
    }
    batch.push(chunk)
    tokens += next
  }
  return batch
}
