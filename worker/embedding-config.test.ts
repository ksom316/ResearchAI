import { describe, expect, it } from 'vitest'
import { ConfigError } from './config'
import { loadEmbeddingConfig } from './embedding-config'

// A fake key; the real key is only ever read from .env.worker at runtime.
const base = {
  EMBEDDING_API_KEY: 'pa-FAKEKEY_abcdefghijklmnopqrstuvwxyz012345',
}

describe('loadEmbeddingConfig', () => {
  it('applies documented defaults and locks the Phase 4 profile', () => {
    expect(loadEmbeddingConfig(base)).toEqual({
      apiKey: base.EMBEDDING_API_KEY,
      model: 'voyage-4',
      dimensions: 1024,
      batchSize: 32,
      timeoutMs: 30_000,
      maxAttempts: 4,
      requestsPerMinute: 3,
      tokensPerMinute: 10_000,
      maxRequestTokens: 4_000,
      jobMaxAttempts: 4,
      staleAfterMinutes: 15,
      stageEnabled: false,
    })
  })

  it('requires EMBEDDING_API_KEY and never echoes anything secret', () => {
    expect(() => loadEmbeddingConfig({})).toThrowError(ConfigError)
    expect(() => loadEmbeddingConfig({})).toThrowError(/EMBEDDING_API_KEY/)
    expect(() =>
      loadEmbeddingConfig({ EMBEDDING_API_KEY: '   ' }),
    ).toThrowError(/EMBEDDING_API_KEY/)
  })

  it('does not accept a VITE_-prefixed key as a fallback', () => {
    expect(() =>
      loadEmbeddingConfig({ VITE_EMBEDDING_API_KEY: base.EMBEDDING_API_KEY }),
    ).toThrowError(ConfigError)
  })

  it('rejects the placeholder from .env.worker.example and malformed keys', () => {
    for (const value of [
      'your-voyage-api-key',
      'has spaces in it 1234567890',
      'short',
    ]) {
      const attempt = () => loadEmbeddingConfig({ EMBEDDING_API_KEY: value })
      expect(attempt).toThrowError(ConfigError)
      try {
        attempt()
      } catch (e) {
        expect((e as Error).message).not.toContain(value)
      }
    }
  })

  it('tolerates whitespace and Windows line endings around the key', () => {
    const crlf = String.fromCharCode(13, 10)
    const config = loadEmbeddingConfig({
      EMBEDDING_API_KEY: `  ${base.EMBEDDING_API_KEY}${crlf}`,
    })
    expect(config.apiKey).toBe(base.EMBEDDING_API_KEY)
  })

  it('refuses any model or dimension other than the locked voyage-4 / 1024', () => {
    expect(
      loadEmbeddingConfig({
        ...base,
        EMBEDDING_MODEL: 'voyage-4',
        EMBEDDING_DIMENSIONS: '1024',
      }),
    ).toMatchObject({
      model: 'voyage-4',
      dimensions: 1024,
    })
    expect(() =>
      loadEmbeddingConfig({ ...base, EMBEDDING_MODEL: 'voyage-4-large' }),
    ).toThrowError(/voyage-4/)
    expect(() =>
      loadEmbeddingConfig({ ...base, EMBEDDING_DIMENSIONS: '512' }),
    ).toThrowError(/1024/)
    expect(() =>
      loadEmbeddingConfig({ ...base, EMBEDDING_DIMENSIONS: '2048' }),
    ).toThrowError(/1024/)
  })

  it('validates the tuning options', () => {
    expect(
      loadEmbeddingConfig({ ...base, EMBEDDING_BATCH_SIZE: '64' }).batchSize,
    ).toBe(64)
    expect(
      loadEmbeddingConfig({ ...base, EMBEDDING_MAX_ATTEMPTS: '2' }).maxAttempts,
    ).toBe(2)
    expect(
      loadEmbeddingConfig({ ...base, EMBEDDING_TIMEOUT_MS: '5000' }).timeoutMs,
    ).toBe(5_000)
    for (const bad of [
      { EMBEDDING_BATCH_SIZE: '0' },
      { EMBEDDING_BATCH_SIZE: '500' },
      { EMBEDDING_BATCH_SIZE: 'abc' },
      { EMBEDDING_MAX_ATTEMPTS: '0' },
      { EMBEDDING_MAX_ATTEMPTS: '99' },
      { EMBEDDING_TIMEOUT_MS: '10' },
    ]) {
      expect(() => loadEmbeddingConfig({ ...base, ...bad })).toThrowError(
        ConfigError,
      )
    }
  })

  it('offers no way to redirect the key to another endpoint', () => {
    const config = loadEmbeddingConfig({
      ...base,
      EMBEDDING_BASE_URL: 'https://evil.example.com',
    })
    expect(Object.keys(config)).not.toContain('baseUrl')
  })
})
