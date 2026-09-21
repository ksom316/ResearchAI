import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (relative: string) => readFileSync(join(root, relative), 'utf8')

describe('citation metadata persistence boundaries', () => {
  it('uses request-scoped RLS and explicit citation-only columns', () => {
    const db = read('features/papers/citation-metadata-db.server.ts')
    expect(db).toContain(".from('papers')")
    expect(db).toContain('.update(columns)')
    expect(db).toContain('.select(CITATION_METADATA_PAPER_COLUMNS)')
    expect(db).not.toMatch(/service[_-]?role|process\.env|storage_path|status|processing/i)
  })

  it('has no job, AI, evidence mutation, or direct browser database path', () => {
    const service = read('features/papers/citation-metadata-service.ts')
    const fn = read('features/papers/citation-metadata.functions.ts')
    expect(`${service}\n${fn}`).not.toMatch(
      /openrouter|generateStructured|embedding|paper_chunks|paper_sections|extraction|evidence|worker|service[_-]?role|process\.env/i,
    )
    expect(fn).toContain('createSupabaseServerClient()')
  })

  it('migration is additive and grants only intended metadata updates', () => {
    const migration = read('../supabase/migrations/0012_citation_metadata.sql')
    expect(migration).toContain('alter table public.papers')
    expect(migration).toContain('grant update (')
    expect(migration).not.toMatch(
      /create table|paper_chunks|paper_sections|chunk_embeddings|paper_embedding_jobs|paper_extraction/i,
    )
    expect(migration).not.toMatch(/grant (?:all|insert|delete)/i)
  })
})
