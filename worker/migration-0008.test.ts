import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Design-level checks on migration 0008 (semantic search boundary). They cannot prove
 * runtime behavior (supabase/verification/0008_semantic_search_checks.sql does that
 * against Postgres) but pin the security invariants so an edit cannot silently
 * remove them.
 */
const read = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n')

const raw = read('0008_semantic_search.sql')
/** SQL without -- comments, so prose can't trip the checks. */
const sql = raw.replace(/--.*$/gm, '')

const fn = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  const end = sql.indexOf('\n$$;', sql.indexOf('as $$', start))
  return sql.slice(start, end)
}
/** The body after the `as $$` line. */
const body = (name: string) => {
  const text = fn(name)
  return text.slice(text.indexOf('as $$'))
}

const HELPER = 'search_scope_paper_ids'
const COVERAGE = 'get_search_coverage'
const SEARCH = 'search_paper_chunks'

describe('migration 0008: shape', () => {
  it('is one transaction defining exactly the helper and the two RPCs', () => {
    expect(sql.trimStart().startsWith('begin;')).toBe(true)
    expect(sql.trimEnd().endsWith('commit;')).toBe(true)
    expect(sql.match(/create or replace function public\.(\w+)\(/g)).toEqual([
      `create or replace function public.${HELPER}(`,
      `create or replace function public.${COVERAGE}(`,
      `create or replace function public.${SEARCH}(`,
    ])
  })

  it('creates no table, index (HNSW / IVFFlat) or policy, and alters nothing', () => {
    expect(sql).not.toMatch(/create\s+(table|index|policy|extension|type)/i)
    expect(sql).not.toMatch(/hnsw|ivfflat/i)
    expect(sql).not.toMatch(/\b(alter|drop|truncate)\s/i)
  })

  it('writes to no table (STABLE, no DML anywhere)', () => {
    expect(sql).not.toMatch(
      /\b(insert\s+into|update\s+public|delete\s+from|truncate)\b/i,
    )
    for (const name of [HELPER, COVERAGE, SEARCH]) {
      expect(fn(name), name).toMatch(/\n\s*stable\n/)
      expect(fn(name), name).not.toMatch(/\bvolatile\b/)
    }
  })

  it('makes no provider call and creates no http/network dependency', () => {
    expect(sql).not.toMatch(/voyage|http|net\.|pg_net|dblink/i)
  })
})

describe('migration 0008: security definer boundary', () => {
  it.each([HELPER, COVERAGE, SEARCH])('%s is SECURITY DEFINER', (name) => {
    expect(fn(name)).toMatch(/\n\s*security definer\n/)
    expect(fn(name)).not.toMatch(/security invoker/)
  })

  it('pins a safe search_path on every function', () => {
    expect(sql.match(/set search_path = /g)).toHaveLength(3)
    // Only the search function needs `extensions` (the vector type and <=>).
    expect(fn(SEARCH)).toMatch(/set search_path = extensions, pg_temp/)
    expect(fn(COVERAGE)).toMatch(/set search_path = ''/)
    expect(fn(HELPER)).toMatch(/set search_path = ''/)
    // pg_temp is never searched before the real schemas.
    expect(sql).not.toMatch(/search_path = pg_temp/)
  })

  it('schema-qualifies every table it reads', () => {
    for (const name of [HELPER, COVERAGE, SEARCH]) {
      const text = body(name)
      for (const m of text.matchAll(/\b(?:from|join)\s+([a-z_.]+)/g)) {
        const target = m[1]
        // relations must be public.<t>; unnest(...) and CTE names are the exceptions
        if (['unnest', 'scope', 'top', 't'].includes(target)) continue
        if (/^[a-z]{1,2}[.][a-z_]+$/.test(target)) continue // "is distinct from p.col"
        expect(target, `${name}: ${target}`).toMatch(/^public\./)
      }
    }
  })

  it('takes the caller from auth.uid() and never from a parameter', () => {
    for (const name of [HELPER, COVERAGE, SEARCH]) {
      expect(fn(name), name).toMatch(/v_uid uuid := auth\.uid\(\);/)
      expect(fn(name), name).toMatch(
        /if v_uid is null then\s+raise exception 'search_unauthenticated'/,
      )
    }
    // no parameter of any function is a user id, and no other source of identity
    expect(sql).not.toMatch(/\bp_user_id\b|\buser_id uuid\b/)
    expect(sql).not.toMatch(/current_user|session_user|request\.jwt|set_config/)
    expect(sql.match(/auth\.uid\(\)/g)).toHaveLength(3)
  })
})

describe('migration 0008: grants', () => {
  const revokes = (name: string) =>
    new RegExp(
      `revoke all on function public\\.${name}\\([^)]*\\)\\s+from public, anon, authenticated, service_role;`,
    )

  it.each([HELPER, COVERAGE, SEARCH])(
    '%s starts from no privileges',
    (name) => {
      expect(sql).toMatch(revokes(name))
    },
  )

  it('grants the two public RPCs to authenticated only', () => {
    expect(sql.match(/grant execute on function [^;]+;/g)).toEqual([
      'grant execute on function public.get_search_coverage(uuid[], uuid) to authenticated;',
      'grant execute on function public.search_paper_chunks(jsonb, text, uuid[], uuid, int, double precision, boolean) to authenticated;',
    ])
  })

  it('never grants to anon, public or service_role, and never grants the helper', () => {
    expect(sql).not.toMatch(/grant [^;]*\bto\s+(anon|public|service_role)\b/i)
    expect(sql).not.toMatch(new RegExp(`grant[^;]*${HELPER}`))
    expect(sql).not.toMatch(/grant (select|insert|update|delete|all)\b/i)
  })

  it('the revoke of the helper comes with the same signature it was created with', () => {
    expect(fn(HELPER)).toMatch(/p_paper_ids uuid\[\] default null,/)
    expect(sql).toMatch(/public\.search_scope_paper_ids\(uuid\[\], uuid\)/)
  })
})

describe('migration 0008: scope resolution (helper)', () => {
  const text = body(HELPER)

  it('caps and validates the paper list, uniformly', () => {
    expect(text).toMatch(/array_agg\(distinct x\)/)
    expect(text).toMatch(
      /cardinality\(v_ids\) < 1 or cardinality\(v_ids\) > 50/,
    )
    expect(text).toMatch(/where x is null/)
    expect(text).toMatch(/raise exception 'search_invalid_argument'/)
  })

  it('every requested paper must be owned, else the same scope error as a missing id', () => {
    expect(text).toMatch(
      /count\(\*\) from public\.papers p\s+where p\.user_id = v_uid and p\.id = any \(v_ids\)\) <> cardinality\(v_ids\)/,
    )
    expect(
      text.match(/raise exception 'search_scope_not_found'/g),
    ).toHaveLength(2)
  })

  it('the project must be owned by the caller', () => {
    expect(text).toMatch(
      /from public\.research_projects rp\s+where rp\.id = p_project_id and rp\.user_id = v_uid/,
    )
  })

  it('project membership requires a link owned by the caller', () => {
    expect(text).toMatch(
      /from public\.paper_project_links l\s+where l\.paper_id = p\.id\s+and l\.project_id = p_project_id\s+and l\.user_id = v_uid/,
    )
  })

  it('only ever returns papers the caller owns', () => {
    expect(text).toMatch(
      /return query\s+select p\.id\s+from public\.papers p\s+where p\.user_id = v_uid/,
    )
  })
})

describe('migration 0008: coverage', () => {
  const text = body(COVERAGE)

  it('has the documented signature and columns', () => {
    expect(fn(COVERAGE)).toMatch(
      /get_search_coverage\(\s*p_paper_ids uuid\[\] default null,\s*p_project_id uuid default null\s*\)\s*returns table \(\s*paper_id uuid,\s*paper_title text,\s*state text,\s*chunk_count int\s*\)/,
    )
  })

  it('reads only the ACTIVE profile job, owned by the caller', () => {
    expect(text).toMatch(/where m\.status = 'active'/)
    expect(text).toMatch(
      /left join public\.paper_embedding_jobs j\s+on j\.paper_id = p\.id\s+and j\.model_id = v_model\s+and j\.user_id = v_uid/,
    )
    expect(text).toMatch(/where p\.user_id = v_uid/)
  })

  it('classifies stale generations before reporting complete', () => {
    const stale = text.indexOf("'index_stale'")
    const searchable = text.indexOf("'searchable'")
    expect(stale).toBeGreaterThan(-1)
    expect(stale).toBeLessThan(searchable)
    expect(text).toMatch(
      /j\.source_completed_at is distinct from p\.processing_completed_at/,
    )
  })

  it('reports every state', () => {
    for (const state of [
      'searchable',
      'pdf_processing',
      'pdf_failed',
      'not_indexed',
      'index_pending',
      'indexing',
      'index_failed',
      'index_stale',
    ]) {
      expect(text, state).toContain(`'${state}'`)
    }
  })

  it('counts chunks only for the caller and exposes no vector, hash or job field', () => {
    expect(text).toMatch(/c\.paper_id = p\.id and c\.user_id = v_uid/)
    expect(fn(COVERAGE)).not.toMatch(
      /chunk_embeddings|content_hash|user_id uuid|claim|last_error|attempts|storage_path/,
    )
  })
})

describe('migration 0008: search', () => {
  const head = fn(SEARCH)
  const text = body(SEARCH)

  it('has the documented signature and defaults', () => {
    expect(head).toMatch(
      /search_paper_chunks\(\s*p_query_embedding jsonb,\s*p_expected_model_id text,\s*p_paper_ids uuid\[\] default null,\s*p_project_id uuid default null,\s*p_limit int default 10,\s*p_min_similarity double precision default null,\s*p_include_references boolean default false\s*\)/,
    )
  })

  it('returns only safe columns: no vector, hash, user id, storage path or job internals', () => {
    const returns = head.slice(
      head.indexOf('returns table ('),
      head.indexOf('language plpgsql'),
    )
    for (const column of [
      'rank',
      'similarity',
      'paper_id',
      'paper_title',
      'chunk_id',
      'chunk_index',
      'char_start',
      'char_end',
      'page_start',
      'page_end',
      'section_id',
      'section_title',
      'section_type',
      'section_position',
      'content',
    ]) {
      expect(returns, column).toMatch(new RegExp(`\\b${column}\\b`))
    }
    expect(returns).not.toMatch(
      /embedding|vector|content_hash|user_id|storage_path|claim|attempts|last_error|status/,
    )
    // the final projection never selects the raw vector or hash either
    const finalSelect = text.slice(text.lastIndexOf('select (row_number()'))
    expect(finalSelect).not.toMatch(/embedding|content_hash|user_id|ce\./)
  })

  it('validates the query vector: array, exactly 1024 elements, castable, non-zero', () => {
    expect(text).toMatch(/jsonb_typeof\(p_query_embedding\) <> 'array'/)
    expect(text).toMatch(/jsonb_array_length\(p_query_embedding\) <> 1024/)
    expect(text).toMatch(/\(p_query_embedding::text\)::vector\(1024\)/)
    expect(text).toMatch(/exception when others then/)
    expect(text).toMatch(/\(v_query <#> v_query\) = 0/)
    expect(
      text.match(/raise exception 'search_invalid_embedding'/g),
    ).toHaveLength(3)
  })

  it('validates limit and similarity: default 10, clamp 1..50, similarity in -1..1', () => {
    expect(text).toMatch(
      /v_limit := least\(greatest\(coalesce\(p_limit, 10\), 1\), 50\);/,
    )
    expect(text).toMatch(/p_min_similarity < -1 or p_min_similarity > 1/)
    expect(text).toMatch(/p_expected_model_id is null/)
  })

  it('searches only the active profile and rejects a mismatched expectation', () => {
    expect(text).toMatch(/where m\.status = 'active'/)
    expect(text).toMatch(
      /v_model is null or v_model <> p_expected_model_id then\s+raise exception 'search_model_mismatch'/,
    )
    // the vector is validated before the model lookup, the model before any scan
    expect(text.indexOf('search_model_mismatch')).toBeLessThan(
      text.indexOf('return query'),
    )
    // nothing takes the model id from the caller for the scan itself
    expect(text).not.toMatch(/model_id = p_expected_model_id/)
  })

  it('enforces the current-generation and ownership predicates', () => {
    const join = (t: string) => t.replace(/\s+/g, ' ')
    const flat = join(text)
    for (const predicate of [
      "p.user_id = v_uid and p.status = 'ready'",
      'p.processing_completed_at is not null',
      'j.paper_id = p.id and j.model_id = v_model and j.user_id = v_uid',
      "j.status = 'complete'",
      'j.source_completed_at = p.processing_completed_at',
      'c.paper_id = p.id and c.user_id = v_uid',
      'ce.chunk_id = c.id and ce.model_id = v_model and ce.paper_id = c.paper_id and ce.user_id = v_uid and ce.content_hash is not null',
      's.id = c.section_id and s.paper_id = c.paper_id and s.user_id = v_uid',
    ]) {
      expect(flat, predicate).toContain(predicate)
    }
  })

  it('excludes references unless asked, and treats a null flag as false', () => {
    expect(text).toMatch(
      /coalesce\(p_include_references, false\) or s\.section_type <> 'references'/,
    )
  })

  it('ranks by exact cosine distance with a deterministic tie-break', () => {
    expect(text).toMatch(
      /order by \(ce\.embedding <=> v_query\), p\.id, c\.chunk_index\s+limit v_limit/,
    )
    expect(text).toMatch(/\(1 - t\.dist\)::double precision/)
    expect(text).toMatch(/order by t\.dist, t\.pid, t\.cidx/)
    // no distance operator other than cosine
    expect(text).not.toMatch(/<->|<#>\s*ce|<\+>/)
  })

  it('applies the optional similarity floor as 1 - distance', () => {
    expect(text).toMatch(
      /p_min_similarity is null or \(1 - \(ce\.embedding <=> v_query\)\) >= p_min_similarity/,
    )
  })

  it('scopes through the private helper, never through raw ids', () => {
    expect(text).toMatch(
      /from public\.search_scope_paper_ids\(p_paper_ids, p_project_id\) as sc/,
    )
    expect(text).toMatch(/on p\.id = scope\.pid/)
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
  }
  it.each(Object.entries(pinned))('%s is unchanged', (name, hash) => {
    expect(createHash('sha256').update(read(name)).digest('hex')).toBe(hash)
  })
})
