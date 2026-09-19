import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Design-level checks on migration 0009 (Evidence Matrix foundation). They cannot prove
 * runtime behavior (supabase/verification/0009_evidence_matrix_checks.sql does that
 * against Postgres) but pin the security and provenance invariants.
 */
const read = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n')

const raw = read('0009_evidence_matrix_foundation.sql')
/** SQL without -- comments, so prose can't trip the checks. */
const sql = raw.replace(/--.*$/gm, '')

const table = (name: string) => {
  const start = sql.indexOf(`create table public.${name} (`)
  expect(start, name).toBeGreaterThan(-1)
  return sql.slice(start, sql.indexOf('\n);', start))
}
const fn = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return sql.slice(start, sql.indexOf('\n$$;', sql.indexOf('as $$', start)))
}

const FUNCTIONS = [
  'claim_paper_extraction',
  'store_extraction_field',
  'complete_paper_extraction',
  'fail_paper_extraction',
]

describe('migration 0009: shape', () => {
  it('is one transaction with exactly the three tables, the view and four functions', () => {
    expect(sql.trimStart().startsWith('begin;')).toBe(true)
    expect(sql.trimEnd().endsWith('commit;')).toBe(true)
    expect(sql.match(/create table public\.(\w+)/g)).toEqual([
      'create table public.paper_extractions',
      'create table public.paper_extraction_fields',
      'create table public.paper_extraction_sources',
    ])
    expect(sql.match(/create or replace function public\.(\w+)\(/g)).toEqual(
      FUNCTIONS.map((f) => `create or replace function public.${f}(`),
    )
    expect(sql.match(/create view public\.(\w+)/g)).toEqual([
      'create view public.paper_extraction_overview',
    ])
  })

  it('does not alter or drop any existing object and adds no vector index', () => {
    expect(sql).not.toMatch(
      /\balter table public\.(papers|paper_sections|paper_chunks|paper_project_links|research_projects|embedding_models|chunk_embeddings|paper_embedding_jobs)\b/i,
    )
    expect(sql).not.toMatch(/\b(drop|truncate)\b/i)
    expect(sql).not.toMatch(/hnsw|ivfflat|vector/i)
    expect(sql).not.toMatch(
      /create (unique )?index[^;]*using (gin|gist|hnsw|ivfflat)/i,
    )
  })

  it('makes no LLM or provider call', () => {
    expect(sql).not.toMatch(/openrouter|voyage|http|net\./i)
  })
})

describe('migration 0009: ownership and identity', () => {
  it('one extraction per paper and schema version, owned through papers (id, user_id)', () => {
    const t = table('paper_extractions')
    expect(t).toMatch(/primary key \(paper_id, schema_version\)/)
    expect(t).toMatch(/unique \(paper_id, schema_version, user_id\)/)
    expect(t).toMatch(
      /foreign key \(paper_id, user_id\)\s+references public\.papers \(id, user_id\) on delete cascade/,
    )
    expect(t).toMatch(
      /schema_version int not null check \(schema_version between 1 and 1000\)/,
    )
  })

  it('statuses are exactly pending/running/complete/partial/failed (no stored stale)', () => {
    expect(table('paper_extractions')).toMatch(
      /status in \('pending', 'running', 'complete', 'partial', 'failed'\)/,
    )
    expect(sql).not.toMatch(/'stale'/)
  })

  it('has a consistency check tying status to claim, error and completion', () => {
    const t = table('paper_extractions')
    expect(t).toMatch(
      /\(status = 'running'\) = \(claim_started_at is not null\)/,
    )
    expect(t).toMatch(/\(status = 'failed'\) = \(last_error is not null\)/)
    expect(t).toMatch(
      /status not in \('complete', 'partial'\) or completed_at is not null/,
    )
  })

  it('fields are limited to the seven keys and three states, owned via the extraction', () => {
    const t = table('paper_extraction_fields')
    for (const key of [
      'objective',
      'methodology',
      'dataset',
      'findings',
      'limitations',
      'future_work',
      'concepts',
    ]) {
      expect(t, key).toContain(`'${key}'`)
    }
    expect(t).toMatch(/state in \('extracted', 'not_reported', 'failed'\)/)
    expect(t).toMatch(/primary key \(paper_id, schema_version, field_key\)/)
    expect(t).toMatch(
      /foreign key \(paper_id, schema_version, user_id\)\s+references public\.paper_extractions \(paper_id, schema_version, user_id\)\s+on delete cascade/,
    )
  })

  it('bounds the JSON value and cannot pass on NULL', () => {
    const t = table('paper_extraction_fields')
    expect(t).toMatch(/jsonb_typeof\(value\) = 'object'/)
    expect(t).toMatch(/octet_length\(value::text\) <= 20000/)
    expect(t).toMatch(/between 1 and 12/)
    // a NULL check result would pass, so every array length is coalesced
    expect(t.match(/coalesce\(case when jsonb_typeof/g)).toHaveLength(2)
  })
})

describe('migration 0009: provenance survives reprocessing', () => {
  const t = table('paper_extraction_sources')

  it('same-owner foreign keys to chunks and sections clear the pointer instead of deleting the row', () => {
    expect(t).toMatch(
      /foreign key \(chunk_id, paper_id, user_id\)\s+references public\.paper_chunks \(id, paper_id, user_id\) on delete set null \(chunk_id\)/,
    )
    expect(t).toMatch(
      /foreign key \(section_id, paper_id\)\s+references public\.paper_sections \(id, paper_id\) on delete set null \(section_id\)/,
    )
    // nothing that references chunks or sections may cascade-delete a source
    expect(t).not.toMatch(/paper_(chunks|sections)[^;]*on delete cascade/)
  })

  it('keeps a bounded snapshot and never the paper title', () => {
    for (const column of [
      'section_title',
      'section_type',
      'page_start',
      'page_end',
      'excerpt',
    ]) {
      expect(t, column).toContain(column)
    }
    expect(t).toMatch(/char_length\(excerpt\) between 1 and 400/)
    expect(t).not.toMatch(/paper_title|\bpapers?\.title/)
    expect(t).toMatch(/chunk_id uuid,\s+section_id uuid,/) // nullable live pointers
  })

  it('cascades from the field, and indexes the pointers used by the set-null actions', () => {
    expect(t).toMatch(
      /references public\.paper_extraction_fields \(paper_id, schema_version, field_key, user_id\)\s+on delete cascade/,
    )
    expect(sql).toMatch(
      /create index paper_extraction_sources_chunk_idx on public\.paper_extraction_sources \(chunk_id\)/,
    )
    expect(sql).toMatch(
      /create index paper_extraction_sources_section_idx on public\.paper_extraction_sources \(section_id\)/,
    )
  })
})

describe('migration 0009: derived staleness', () => {
  it('the view derives is_stale from the generation markers and runs as the caller', () => {
    const start = sql.indexOf('create view public.paper_extraction_overview')
    const view = sql.slice(start, sql.indexOf(';', start))
    expect(view).toMatch(/with \(security_invoker = true\)/)
    expect(view).toMatch(
      /\(e\.source_completed_at is distinct from p\.processing_completed_at\) as is_stale/,
    )
  })

  it('does not depend on a trigger on papers or a change to the processing pipeline', () => {
    expect(sql).not.toMatch(/on public\.papers/)
    expect(sql).not.toMatch(/complete_paper_processing|claim_next_paper/)
  })

  it('a new generation discards the old fields before the new claim', () => {
    const claim = fn('claim_paper_extraction')
    expect(claim).toMatch(/if v_current is distinct from v_generation then/)
    expect(claim).toMatch(/delete from public\.paper_extraction_fields/)
    expect(claim).toMatch(/p\.status = 'ready'/)
  })

  it('an unchanged, completed generation is not claimable; a stale one is via the reset', () => {
    const claim = fn('claim_paper_extraction')
    expect(claim).toMatch(
      /e\.status in \('pending', 'failed', 'partial'\)\s+or \(e\.status = 'running' and e\.updated_at < now\(\) - p_stale_after\)/,
    )
    // the generation mismatch resets any status (incl. complete) to pending first
    expect(claim.indexOf("set status = 'pending'")).toBeLessThan(
      claim.indexOf("set status = 'running'"),
    )
  })
})

describe('migration 0009: security', () => {
  it('enables RLS on every table and grants owner-only reads', () => {
    for (const name of [
      'paper_extractions',
      'paper_extraction_fields',
      'paper_extraction_sources',
    ]) {
      expect(sql).toContain(
        `alter table public.${name} enable row level security;`,
      )
    }
    expect(
      sql.match(
        /create policy [^;]*for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\);/g,
      ),
    ).toHaveLength(3)
    expect(sql).not.toMatch(/create policy [^;]*for (insert|update|delete|all)/)
  })

  it('revokes everything from anon/authenticated first, then grants read-only columns', () => {
    expect(sql).toMatch(
      /revoke all on public\.paper_extractions, public\.paper_extraction_fields,\s+public\.paper_extraction_sources, public\.paper_extraction_overview\s+from anon, authenticated;/,
    )
    expect(sql).not.toMatch(
      /grant (insert|update|delete|all)[^;]*to authenticated/i,
    )
    expect(sql).not.toMatch(
      /grant select on public\.paper_extraction(s|_fields|_sources) to authenticated/,
    )
  })

  it('hides user_id, attempts, claim token and errors from browsers', () => {
    const grants = [
      ...sql.matchAll(
        /grant select \(([^)]*)\)\s+on public\.(\w+) to authenticated;/g,
      ),
    ]
    expect(grants.map((g) => g[2])).toEqual([
      'paper_extractions',
      'paper_extraction_fields',
      'paper_extraction_sources',
    ])
    for (const [, columns] of grants) {
      expect(columns).not.toMatch(
        /user_id|attempts|claim_started_at|last_error/,
      )
    }
  })

  it('only service_role writes; the four functions are revoked from every browser role', () => {
    expect(sql).toMatch(
      /grant select, insert, update, delete\s+on public\.paper_extractions, public\.paper_extraction_fields, public\.paper_extraction_sources\s+to service_role;/,
    )
    for (const name of FUNCTIONS) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}\\([^)]*\\)\\s+from public, anon, authenticated;`,
        ),
      )
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${name}\\([^)]*\\) to service_role;`,
        ),
      )
    }
    expect(sql).not.toMatch(/grant execute[^;]*to (public|anon|authenticated)/i)
  })

  it('functions pin an empty search_path and none is SECURITY DEFINER-unpinned', () => {
    expect(sql.match(/set search_path = ''/g)).toHaveLength(4)
    expect(sql).not.toMatch(/security definer/i)
    expect(sql).not.toMatch(/search_path = (public|pg_temp)/)
  })

  it('takes no caller identity: no auth.uid() and no user id parameter', () => {
    expect(sql).not.toMatch(/p_user_id/)
    for (const name of FUNCTIONS) {
      expect(fn(name), name).not.toMatch(/auth\.uid\(\)/)
    }
  })
})

describe('migration 0009: fenced, database-derived writes', () => {
  it('store/complete/fail require the running claim token; store and complete also the generation', () => {
    for (const name of [
      'store_extraction_field',
      'complete_paper_extraction',
      'fail_paper_extraction',
    ]) {
      expect(fn(name), name).toMatch(/e\.status = 'running'/)
      expect(fn(name), name).toMatch(/e\.claim_started_at = p_claim_started_at/)
    }
    for (const name of [
      'store_extraction_field',
      'complete_paper_extraction',
    ]) {
      expect(fn(name), name).toMatch(
        /e\.source_completed_at = p\.processing_completed_at/,
      )
      expect(fn(name), name).toMatch(/p\.status = 'ready'/)
    }
  })

  it('citation metadata comes from the chunk and section rows, and excerpts must be verbatim', () => {
    const store = fn('store_extraction_field')
    expect(store).toMatch(
      /s\.title, s\.section_type, c\.page_start, c\.page_end, x\.excerpt/,
    )
    expect(store).toMatch(/c\.paper_id = p_paper_id and c\.user_id = v_user/)
    expect(store).toMatch(/position\(x\.excerpt in c\.text\) > 0/)
    expect(store).toMatch(/x\.item_index < v_items/)
    expect(store).toMatch(/v_n <> jsonb_array_length\(p_sources\)/)
    // the source jsonb never supplies titles, types or pages
    expect(store).not.toMatch(
      /x\((?:[^)]*)(section_title|section_type|page_start|page_end)/,
    )
  })

  it('only extracted fields may carry sources', () => {
    expect(fn('store_extraction_field')).toMatch(
      /p_state <> 'extracted' and jsonb_array_length\(p_sources\) > 0/,
    )
  })

  it('the final status is computed by the database, not chosen by the caller', () => {
    const complete = fn('complete_paper_extraction')
    expect(complete).not.toMatch(/p_status/)
    expect(complete).toMatch(
      /v_fields = 7 and v_failed = 0 then 'complete' else 'partial'/,
    )
  })

  it('failure text is truncated and stays in the internal column', () => {
    expect(fn('fail_paper_extraction')).toMatch(
      /left\(nullif\(trim\(p_error\), ''\), 500\)/,
    )
  })
})

describe('migration 0009: indexes', () => {
  it('adds only B-tree indexes on the documented columns', () => {
    expect(sql.match(/create index (\w+)/g)).toEqual([
      'create index paper_extractions_user_idx',
      'create index paper_extractions_open_idx',
      'create index paper_extraction_sources_chunk_idx',
      'create index paper_extraction_sources_section_idx',
    ])
  })
})

describe('applied migrations stay untouched', () => {
  const pinned: Record<string, string> = {
    '0001_foundation.sql':
      '07deecc51ca11c224c28b5c604a040313881211dcfd746b683ca662f6e705987',
    '0002_paper_ingestion.sql':
      '8ab8edac85e81b61ef1998603d87a6c4866e48a14a315865623ab43440ca627b',
    '0003_paper_project_links.sql':
      '2c9a70b0ae35deba121bf4b2a2b16becccc365a33a140fcf2d0224a5b8bdd4f7',
    '0004_paper_processing.sql':
      'd5d0cb59669966fefe08f3388ebfbd29e26f98cc7bcb9c736312e1114b484cbd',
    '0005_processing_worker.sql':
      '13c8b93cc141d2b6dd5dae21c1d80bbc7b207c1b6a37a44c5c71b1346125240d',
    '0006_vector_foundation.sql':
      '459418cacd6492ac622f07281db79471ce8134dfd88f850b6dbe13c8790a29cd',
    '0007_embedding_worker.sql':
      '3f7c63057032261d9d895e2159711a2f7e4e6371138c2fc1b1d950d54b2cfae5',
    '0008_semantic_search.sql':
      'fbd578261d385f48930b27ba61823dd6cebcf8c2fea9b429347113f6328ca384',
  }
  it.each(Object.entries(pinned))('%s is unchanged', (name, hash) => {
    expect(createHash('sha256').update(read(name)).digest('hex')).toBe(hash)
  })
})
