import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const directory = new URL('.', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
)
const implementationFiles = readdirSync(directory).filter(
  (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
)
const source = (file: string) => readFileSync(join(directory, file), 'utf8')
const code = (file: string) =>
  source(file)
    .replace(/\/\*[^]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('Writer security boundaries', () => {
  it('keeps the 7A.2 evidence foundation provider-independent', () => {
    for (const file of [
      'evidence.ts',
      'sanitize.ts',
      'schemas.ts',
      'writer-db.server.ts',
      'writer-service.ts',
    ]) {
      expect(code(file), file).not.toMatch(
        /OpenRouter|generateStructured|generateText|LLM_MODEL|OPENROUTER_API_KEY|lib\/llm/,
      )
    }
  })

  it('uses only the request-scoped authenticated Supabase client', () => {
    const fn = code('writer.functions.ts')
    expect(fn).toMatch(/createSupabaseServerClient\(\)/)
    expect(fn).not.toMatch(/createClient\(|service.?role/i)
    expect(code('writer-db.server.ts')).not.toMatch(/service.?role/i)
  })

  it('reads provider configuration only through the existing server-only adapter', () => {
    const fn = code('writer.functions.ts')
    expect(fn).toMatch(/createServerLlm\(\)/)
    for (const file of implementationFiles) {
      expect(code(file), file).not.toMatch(
        /OPENROUTER_API_KEY|LLM_MODEL|LLM_STRUCTURED_MODE|process\.env|import\.meta\.env/,
      )
    }
  })

  it('keeps database access read-only with explicit column lists', () => {
    const db = code('writer-db.server.ts')
    expect(db).not.toMatch(/\.select\(['"]\*['"]\)/)
    expect(db).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    expect(db).not.toMatch(/chunk_embeddings|storage_path|user_id/)
    expect(
      [...db.matchAll(/\.from\('([a-z_]+)'\)/g)].map((match) => match[1]),
    ).toEqual([
      'research_projects',
      'papers',
      'paper_extraction_overview',
      'paper_extraction_fields',
      'paper_extraction_sources',
      'paper_chunks',
    ])
  })

  it('does not import browser data adapters into the server database adapter', () => {
    expect(source('writer-db.server.ts')).not.toMatch(
      /supabase\/client|evidence-matrix\/api/,
    )
  })

  it('keeps persistence, UI, Gap derivation, and provider logging out of the feature', () => {
    const all = implementationFiles.map(source).join('\n')
    expect(all).not.toMatch(
      /deriveGapCandidates|research-map|components\/ui|\.tsx|\.(insert|update|upsert|delete)\(|console\.(log|error)/,
    )
  })

  it('the server accepts only raw Writer requests and prepares evidence internally', () => {
    const fn = code('writer.functions.ts')
    expect(fn).toMatch(/validator\(\(data: unknown\) => data\)/)
    expect(fn).toMatch(/prepareWriterEvidence\(request, evidenceDeps\)/)
    expect(fn).not.toMatch(/data\.(evidence|provider|model|userId)/)
  })
})
