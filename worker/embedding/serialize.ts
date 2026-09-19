import type { EmbeddingRow } from './types'
import type { PlannedChunk } from './plan'

/** Thrown when a vector fails validation right before persistence (never retryable). */
export class InvalidVectorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidVectorError'
  }
}

/**
 * Validates a provider vector once more and returns a plain copy ready to be sent
 * as a JSON array of numbers. The database casts that array to vector(1024)
 * server-side (a parameterized RPC argument), so no SQL text is ever assembled here.
 */
export function vectorPayload(
  vector: readonly number[],
  dimensions: number,
): number[] {
  if (vector.length !== dimensions) {
    throw new InvalidVectorError(
      `Expected ${dimensions} dimensions but got ${vector.length}`,
    )
  }
  for (const value of vector) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new InvalidVectorError('Vector contains a non-finite value')
    }
  }
  return [...vector]
}

/** Pairs a batch with its vectors (same order) into rows for store_chunk_embeddings. */
export function toEmbeddingRows(
  batch: readonly PlannedChunk[],
  vectors: readonly (readonly number[])[],
  dimensions: number,
): EmbeddingRow[] {
  if (vectors.length !== batch.length) {
    throw new InvalidVectorError(
      `Expected ${batch.length} vectors but got ${vectors.length}`,
    )
  }
  return batch.map((chunk, i) => ({
    chunkId: chunk.chunkId,
    embedding: vectorPayload(vectors[i], dimensions),
    contentHash: chunk.hash,
  }))
}
