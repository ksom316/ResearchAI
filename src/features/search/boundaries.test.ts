import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(
  new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  '..',
  '..',
  '..',
)
const source = (path: string) => readFileSync(path, 'utf8')
const code = (path: string) =>
  source(path)
    .replace(/\/\*[^]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )

const searchDir = join(root, 'src/features/search')
const files = readdirSync(searchDir).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
)

describe('search boundaries', () => {
  it('the query embedder is a .server module', () => {
    expect(files).toContain('query-embedder.server.ts')
  })

  it('only the .server embedder reads the key, and never as a VITE_ variable', () => {
    for (const file of files) {
      const text = code(join(searchDir, file))
      expect(text, file).not.toMatch(/VITE_[A-Z_]*(EMBEDDING|VOYAGE|SERVICE)/)
      expect(text, file).not.toMatch(/SERVICE_ROLE/)
      if (file !== 'query-embedder.server.ts') {
        expect(text, file).not.toMatch(/EMBEDDING_API_KEY|process\.env/)
      }
    }
    expect(code(join(searchDir, 'query-embedder.server.ts'))).toMatch(
      /env\.EMBEDDING_API_KEY/,
    )
  })

  it('uses the request-scoped cookie client only, never a service-role client', () => {
    const fn = code(join(searchDir, 'search.functions.ts'))
    expect(fn).toMatch(/createSupabaseServerClient\(\)/)
    expect(fn).not.toMatch(/createClient\(|service_role/i)
  })

  it('only the server function file imports the .server module', () => {
    for (const file of walk(join(root, 'src')).filter(
      (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith('.test.ts'),
    )) {
      if (/query-embedder\.server/.test(source(file))) {
        expect(file.replace(/\\/g, '/')).toMatch(
          /features\/search\/search\.functions\.ts$/,
        )
      }
    }
  })

  it('no component or route imports search internals other than the server function', () => {
    for (const file of walk(join(root, 'src')).filter((p) =>
      /\.(ts|tsx)$/.test(p),
    )) {
      if (file.replace(/\\/g, '/').includes('features/search/')) continue
      expect(source(file), file).not.toMatch(
        /features\/search\/(query-embedder|search-db|search-service)/,
      )
    }
  })

  it('the service and schemas never build a ctx-v1 document input', () => {
    for (const file of files) {
      expect(code(join(searchDir, file)), file).not.toMatch(
        /buildDocumentInput|documentInputWithHash/,
      )
    }
  })

  it('does not touch the database except through the two RPCs and the profile read', () => {
    const db = code(join(searchDir, 'search-db.ts'))
    expect(db).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    expect(db).not.toMatch(/chunk_embeddings/)
    expect([...db.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1])).toEqual(
      ['embedding_models'],
    )
  })
})
