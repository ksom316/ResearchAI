import { describe, expect, it } from 'vitest'
import { NullOcrProvider, OcrUnavailableError } from './ocr-provider'

describe('NullOcrProvider', () => {
  it('rejects with OcrUnavailableError rather than fabricating a result', async () => {
    const provider = new NullOcrProvider()
    await expect(provider.recognizePage()).rejects.toBeInstanceOf(
      OcrUnavailableError,
    )
  })
})
