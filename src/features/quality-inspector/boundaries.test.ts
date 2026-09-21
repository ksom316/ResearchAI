import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const files = [
  'src/features/quality-inspector/workspace-adapter.ts',
  'src/features/quality-inspector/queries.ts',
  'src/features/quality-inspector/ui/quality-inspector-tab.tsx',
]

describe('Quality Inspector workspace boundaries', () => {
  it('uses authenticated search coverage without provider, environment, or service-role access', () => {
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(source).not.toContain('process.env')
    expect(source).not.toMatch(/service[_-]?role/iu)
    expect(source).not.toMatch(/OpenRouter|llm|embedSearchQuery|search_paper_chunks/iu)
    expect(source).not.toMatch(/\.from\(['"](?:paper_chunk_embeddings|embedding_jobs)/u)
    expect(source).toContain('searchCoverageFn')
    expect(readFileSync('src/features/search/search-db.ts', 'utf8')).toContain(
      "rpc('get_search_coverage'",
    )
  })
})
