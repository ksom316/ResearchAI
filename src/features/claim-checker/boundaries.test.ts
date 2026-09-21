import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const directory = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const implementationFiles = readdirSync(directory).filter(
  (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
)
const source = (file: string) => readFileSync(join(directory, file), 'utf8')
const all = implementationFiles.map(source).join('\n')

describe('Claim Checker 7B.2 security boundaries', () => {
  it('has no provider, prompt, semantic retrieval, UI, or persistence path', () => {
    expect(all).not.toMatch(
      /OpenRouter|generateStructured|createServerLlm|lib\/llm|runSemanticSearch|embedSearchQuery|components\/ui|\.tsx|createServerFn/,
    )
    expect(implementationFiles).not.toContain('prompt.ts')
  })

  it('has no environment, service-role, logging, or database-write path', () => {
    expect(all).not.toMatch(
      /process\.env|import\.meta\.env|service.?role|console\.|\.(insert|update|upsert|delete)\(/i,
    )
  })

  it('accepts only a WriterDb dependency and reuses the shared locator resolver', () => {
    const evidence = source('evidence.ts')
    expect(evidence).toMatch(/resolveWriterEvidenceLocators/)
    expect(evidence).toMatch(/deps: \{ db: WriterDb \}/)
    expect(evidence).not.toMatch(/supabase|userId|provider|model|prompt:/i)
  })
})
