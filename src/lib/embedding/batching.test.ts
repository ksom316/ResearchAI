import { describe, expect, it } from 'vitest'
import {
  MAX_INPUT_CHARS,
  MAX_QUERY_CHARS,
  assertValidDocumentInputs,
  assertValidQuery,
  planBatches,
} from './batching'
import type { EmbeddingError } from './errors'

const items = (count: number, length = 10) =>
  Array.from({ length: count }, (_, i) => String(i).padEnd(length, 'x'))

describe('planBatches', () => {
  it('splits by item count and preserves order', () => {
    const inputs = items(70)
    const batches = planBatches(inputs, { maxItems: 32, maxChars: 1_000_000 })
    expect(batches).toEqual([
      { start: 0, end: 32 },
      { start: 32, end: 64 },
      { start: 64, end: 70 },
    ])
    // The ranges tile the input exactly, in order.
    expect(batches.flatMap((b) => inputs.slice(b.start, b.end))).toEqual(inputs)
  })

  it('splits by character budget', () => {
    const inputs = items(10, 100)
    const batches = planBatches(inputs, { maxItems: 100, maxChars: 350 })
    expect(
      batches.every((b) => inputs.slice(b.start, b.end).join('').length <= 350),
    ).toBe(true)
    expect(batches).toHaveLength(4)
    expect(batches.flatMap((b) => inputs.slice(b.start, b.end))).toEqual(inputs)
  })

  it('never returns an empty batch and gives an oversized input its own batch', () => {
    const inputs = ['a', 'b'.repeat(500), 'c']
    const batches = planBatches(inputs, { maxItems: 10, maxChars: 100 })
    expect(batches).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ])
  })

  it('returns nothing for no inputs', () => {
    expect(planBatches([], { maxItems: 5, maxChars: 100 })).toEqual([])
  })

  it('never sends hundreds of inputs in one request at the default limits', () => {
    const batches = planBatches(items(500), { maxItems: 32, maxChars: 240_000 })
    expect(
      Math.max(...batches.map((b) => b.end - b.start)),
    ).toBeLessThanOrEqual(32)
  })

  it('rejects non-positive limits', () => {
    expect(() => planBatches(['a'], { maxItems: 0, maxChars: 10 })).toThrow(
      RangeError,
    )
    expect(() => planBatches(['a'], { maxItems: 1, maxChars: 0 })).toThrow(
      RangeError,
    )
  })
})

describe('input validation', () => {
  const kind = (fn: () => void) => {
    try {
      fn()
    } catch (e) {
      return (e as EmbeddingError).kind
    }
    return 'none'
  }

  it('rejects an empty batch', () => {
    expect(kind(() => assertValidDocumentInputs([]))).toBe('invalid_input')
  })

  it.each([[''], ['   '], ['\n\t']])('rejects blank input %j', (blank) => {
    expect(kind(() => assertValidDocumentInputs(['ok', blank]))).toBe(
      'invalid_input',
    )
    expect(kind(() => assertValidQuery(blank))).toBe('invalid_input')
  })

  it('rejects non-string inputs', () => {
    expect(
      kind(() => assertValidDocumentInputs([42 as unknown as string])),
    ).toBe('invalid_input')
  })

  it('rejects oversized inputs and names the position, not the text', () => {
    const secret = 'PRIVATE-CHUNK-TEXT '.repeat(MAX_INPUT_CHARS / 10)
    try {
      assertValidDocumentInputs(['fine', secret])
      throw new Error('expected a rejection')
    } catch (e) {
      const message = (e as Error).message
      expect(message).toContain('Input 1')
      expect(message).not.toContain('PRIVATE-CHUNK-TEXT')
    }
  })

  it('enforces the query length cap', () => {
    expect(kind(() => assertValidQuery('q'.repeat(MAX_QUERY_CHARS + 1)))).toBe(
      'invalid_input',
    )
    expect(kind(() => assertValidQuery('What methods were used?'))).toBe('none')
  })
})
