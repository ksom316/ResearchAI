import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const directory = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const implementationFiles = readdirSync(directory).filter(
  (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
)
const source = (file: string) => readFileSync(join(directory, file), 'utf8')
const all = implementationFiles.map(source).join('\n')

describe('Claim Checker security boundaries', () => {
  it('keeps the 7B.2 evidence foundation provider-independent', () => {
    for (const file of ['types.ts', 'schemas.ts', 'sanitize.ts', 'evidence.ts']) {
      expect(source(file), file).not.toMatch(
        /OpenRouter|generateStructured|createServerLlm|lib\/llm|runSemanticSearch|embedSearchQuery/,
      )
    }
  })

  it('has no environment, service-role, database-write, persistence, semantic, or web path', () => {
    expect(all).not.toMatch(
      /process\.env|import\.meta\.env|service.?role|\.(insert|update|upsert|delete)\(|runSemanticSearch|embedSearchQuery|fetch\(|https?:\/\//i,
    )
  })

  it('uses the existing authenticated server boundaries and accepts no browser evidence', () => {
    const fn = source('claim-checker.functions.ts')
    expect(fn).toMatch(/createSupabaseServerClient\(\)/)
    expect(fn).toMatch(/createSupabaseWriterDb\(supabase\)/)
    expect(fn).toMatch(/createServerLlm\(\)/)
    expect(fn).toMatch(/isServerDevelopment\(\)/)
    expect(fn).toMatch(/validator\(\(data: unknown\) => data\)/)
    expect(fn).not.toMatch(/data\.(evidence|provider|model|userId)/)
  })

  it('reuses the one shared authorization path before provider generation', () => {
    const evidence = source('evidence.ts')
    const service = source('assessment-service.ts')
    expect(evidence).toMatch(/resolveWriterEvidenceLocators/)
    expect(service).toMatch(/prepareClaimCheckEvidence/)
    expect(service).not.toMatch(/resolveWriterEvidenceLocators|supabase/)
  })

  it('keeps UI, manual entry, and raw content logging out of 7B.3', () => {
    expect(implementationFiles.some((file) => file.endsWith('.tsx'))).toBe(false)
    expect(all).not.toMatch(/components\/ui|manual.?claim|console\.(log|error)/i)
    const diagnostics = source('diagnostics.server.ts')
    expect(diagnostics).not.toMatch(
      /claimText|promptText|paperId|projectId|userId|excerpt|Authorization/,
    )
  })
})
