import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards for the Phase 4C worker code: it writes only through the fenced RPCs, never
 * touches the PDF lifecycle, never reads secrets from the environment itself, and is
 * not reachable from browser code.
 */
const dir = new URL('.', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
)
const root = join(dir, '..', '..')

const source = (path: string) => readFileSync(path, 'utf8')
/** Code without comments, so documentation can mention tables freely. */
const code = (path: string) =>
  source(path)
    .replace(/\/\*[^]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

const embeddingFiles = readdirSync(dir)
  .filter(
    (f) =>
      f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'test-support.ts',
  )
  .map((f) => join(dir, f))
const entryPoints = [
  join(root, 'worker/embedding-index.ts'),
  join(root, 'worker/scheduler.ts'),
]
const all = [...embeddingFiles, ...entryPoints]

describe('embedding worker boundaries', () => {
  it('writes to the database only through the fenced RPCs', () => {
    for (const file of all) {
      expect(code(file), file).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    }
  })

  it('only READS the papers table (never writes papers or the PDF lifecycle)', () => {
    for (const file of all) {
      const text = code(file)
      for (const match of text.matchAll(/\.from\('([a-z_]+)'\)/g)) {
        expect(
          [
            'papers',
            'paper_sections',
            'paper_chunks',
            'chunk_embeddings',
            'embedding_models',
            'paper_embedding_jobs',
          ],
          file,
        ).toContain(match[1])
      }
      expect(text, file).not.toMatch(
        /processing_(started|completed)_at|processing_error|processing_attempts/,
      )
      expect(text, file).not.toMatch(
        /claim_next_paper|complete_paper_processing|fail_paper_processing/,
      )
    }
  })

  it('does not read process.env directly (config is loaded once and passed in)', () => {
    for (const file of embeddingFiles) {
      expect(code(file), file).not.toMatch(/process\.env/)
    }
  })

  it('has no key-shaped strings and no VITE_ embedding variables', () => {
    for (const file of all) {
      const text = source(file)
      expect(text, file).not.toMatch(/\bpa-[A-Za-z0-9_-]{20,}/)
      expect(text, file).not.toMatch(/VITE_[A-Z_]*(EMBEDDING|VOYAGE|SERVICE)/)
    }
  })

  it('only the manual command prints, and never vectors or text', () => {
    for (const file of embeddingFiles) {
      expect(code(file), file).not.toMatch(/console\./)
    }
    const cli = code(join(root, 'worker/embedding-index.ts'))
    for (const forbidden of ['.embedding', '.input', '.text', 'vector']) {
      expect(
        cli.match(
          new RegExp(
            `console\\.log\\([^)]*${forbidden.replace('.', '\\.')}`,
            'g',
          ),
        ) ?? [],
      ).toHaveLength(0)
    }
  })

  it('is not imported by any browser/application code under src/', () => {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
      )
    for (const file of walk(join(root, 'src')).filter((p) =>
      /\.(ts|tsx)$/.test(p),
    )) {
      expect(source(file), file).not.toMatch(
        /worker\/embedding|from ['"].*\/worker\//,
      )
    }
  })

  it('keeps the low-level default off but requires production docs to enable it', () => {
    const config = code(join(root, 'worker/embedding-config.ts'))
    expect(config).toMatch(/stageEnabled: stage === 'true' \|\| stage === '1'/)
    expect(source(join(root, '.env.worker.example'))).toMatch(
      /^EMBEDDING_STAGE_ENABLED=true$/m,
    )
  })

  it('defaults to the account limits: 3 requests/min and 10,000 tokens/min', () => {
    const config = code(join(root, 'worker/embedding-config.ts'))
    expect(config).toMatch(/'EMBEDDING_RPM_LIMIT',\s*3,/)
    expect(config).toMatch(/'EMBEDDING_TPM_LIMIT',\s*10_000,/)
  })
})

describe('manual indexing command: the dry run can never index', () => {
  const scripts = (
    JSON.parse(source(join(root, 'package.json'))) as {
      scripts: Record<string, string>
    }
  ).scripts
  const cli = code(join(root, 'worker/embedding-index.ts'))

  it('has a dedicated dry-run script with the flag built in (npm cannot swallow it)', () => {
    expect(scripts['embedding:index:dry']).toBe(
      'tsx --env-file=.env.worker worker/embedding-index.ts --dry-run',
    )
  })

  it('keeps the real command unchanged and without the dry-run flag', () => {
    expect(scripts['embedding:index']).toBe(
      'tsx --env-file=.env.worker worker/embedding-index.ts',
    )
    expect(scripts['embedding:index']).not.toContain('--dry-run')
  })

  it('both scripts run the same entry point', () => {
    const entry = (script: string) =>
      /worker\/embedding-index\.ts/.exec(script)?.[0]
    expect(entry(scripts['embedding:index:dry'])).toBe(
      entry(scripts['embedding:index']),
    )
  })

  it('reads the flag and the paper id independent of argument order', () => {
    expect(cli).toMatch(/args\.find\(\(a\) => !a\.startsWith\('--'\)\)/)
    expect(cli).toMatch(/args\.includes\('--dry-run'\)/)
  })

  it('returns from the dry-run branch before any claim, Voyage call or write', () => {
    const branch = cli.indexOf('if (dryRun)')
    expect(branch).toBeGreaterThan(-1)
    expect(cli.slice(branch, branch + 200)).toMatch(/return\s*\n/)

    // Nothing that could index exists before that branch: no runner, no claim/step,
    // no RPC, and no provider.
    const beforeBranch = cli.slice(0, branch)
    for (const forbidden of [
      'createEmbeddingRunner(',
      'runner.step',
      '.rpc(',
      'createVoyageProvider',
      'embedDocuments',
    ]) {
      expect(beforeBranch).not.toContain(forbidden)
    }
    // The runner is only created after the dry-run branch.
    expect(cli.indexOf('createEmbeddingRunner(')).toBeGreaterThan(branch)
  })

  it('help text points to the working dry-run command', () => {
    expect(source(join(root, 'worker/embedding-index.ts'))).toContain(
      'npm run embedding:index:dry -- <paper-id>',
    )
    expect(source(join(root, '.env.worker.example'))).toContain(
      'npm run embedding:index:dry -- <paper-id>',
    )
  })
})
