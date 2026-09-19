import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards for the Phase 4B scope: the embedding client is pure, server-side code
 * that does not touch Supabase, is not reachable from browser code, and contains
 * no secrets. These fail if a later edit crosses those lines by accident.
 */
const root = new URL('..', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
)

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

const source = (path: string) => readFileSync(path, 'utf8')
/** Code with comments removed, so documentation can mention tables without tripping the guards. */
const code = (path: string) =>
  source(path)
    .replace(/\/\*[^]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
const isTest = (path: string) => /\.test\.ts$/.test(path)

const embeddingLib = walk(join(root, 'src/lib/embedding')).filter(
  (p) => !isTest(p),
)
const workerEmbedding = [
  join(root, 'worker/embedding-config.ts'),
  join(root, 'worker/embedding-smoke.ts'),
]
const allEmbeddingCode = [...embeddingLib, ...workerEmbedding]

describe('embedding client boundaries', () => {
  it('never reads environment variables inside the shared client (config is passed in)', () => {
    for (const file of embeddingLib) {
      const text = source(file)
      expect(text, relative(root, file)).not.toMatch(/process\.env/)
      expect(text, relative(root, file)).not.toMatch(/import\.meta\.env/)
    }
  })

  it('does not touch Supabase: no client, no table or RPC access, no writes', () => {
    for (const file of allEmbeddingCode) {
      const text = code(file)
      expect(text, relative(root, file)).not.toMatch(/supabase/i)
      expect(text, relative(root, file)).not.toMatch(
        /\.from\(\s*['"`]|\.rpc\(|\.insert\(|\.upsert\(/,
      )
      expect(text, relative(root, file)).not.toMatch(
        /chunk_embeddings|paper_embedding_jobs/,
      )
    }
  })

  it('is not imported by any browser/application code under src/ (outside the client itself)', () => {
    const others = walk(join(root, 'src')).filter(
      (p) =>
        /\.(ts|tsx)$/.test(p) && !p.includes(join('src', 'lib', 'embedding')),
    )
    for (const file of others) {
      expect(source(file), relative(root, file)).not.toMatch(/lib\/embedding/)
    }
  })

  it('contains no API keys, and defines no VITE_ embedding variable', () => {
    for (const file of allEmbeddingCode) {
      const text = source(file)
      expect(text, relative(root, file)).not.toMatch(/\bpa-[A-Za-z0-9_-]{20,}/)
      expect(text, relative(root, file)).not.toMatch(
        /VITE_[A-Z_]*(EMBEDDING|VOYAGE)/,
      )
    }
  })

  it('only ever sends the key to the fixed Voyage endpoint', () => {
    const urls = new Set<string>()
    for (const file of embeddingLib) {
      for (const match of source(file).matchAll(/https?:\/\/[^\s'"`)]+/g)) {
        urls.add(match[0])
      }
    }
    // The only non-documentation URL is the API base.
    expect([...urls].filter((u) => !u.includes('docs.voyageai.com'))).toEqual([
      'https://api.voyageai.com/v1',
    ])
  })
})

describe('.env.worker.example', () => {
  const example = source(join(root, '.env.worker.example'))

  it('documents the embedding key with a placeholder only', () => {
    expect(example).toMatch(/^EMBEDDING_API_KEY=your-voyage-api-key$/m)
    expect(example).not.toMatch(/\bpa-[A-Za-z0-9_-]{20,}/)
  })

  it('never uses a VITE_ prefix for embedding settings', () => {
    expect(example).not.toMatch(/VITE_.*(EMBEDDING|VOYAGE)/)
  })
})

describe('migration 0006 is unchanged (Phase 4B adds no database changes)', () => {
  it('matches its pinned hash (line endings normalized)', () => {
    const text = source(
      join(root, 'supabase/migrations/0006_vector_foundation.sql'),
    ).replace(/\r\n/g, '\n')
    expect(createHash('sha256').update(text).digest('hex')).toBe(
      '459418cacd6492ac622f07281db79471ce8134dfd88f850b6dbe13c8790a29cd',
    )
  })

  it('has no newer migration yet', () => {
    const migrations = readdirSync(join(root, 'supabase/migrations')).sort()
    expect(migrations.at(-1)).toBe('0006_vector_foundation.sql')
  })
})
