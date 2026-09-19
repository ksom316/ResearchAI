import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Design-level checks on migration 0007 (embedding worker functions). They cannot
 * prove runtime behavior (the in-memory fake in worker/embedding/test-support.ts
 * models it, and supabase/verification/ has queries to run against Postgres), but
 * they pin the invariants the worker relies on so an edit cannot silently remove
 * them.
 */
const read = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n')

const raw = read('0007_embedding_worker.sql')
/** SQL without -- comments, so prose can't trip the checks. */
const sql = raw.replace(/--.*$/gm, '')

const fn = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  const end = sql.indexOf('\n$$;', sql.indexOf('as $$', start))
  return sql.slice(start, end)
}

describe('migration 0007: shape', () => {
  it('is one transaction and defines exactly the four worker functions', () => {
    expect(sql.trimStart().startsWith('begin;')).toBe(true)
    expect(sql.trimEnd().endsWith('commit;')).toBe(true)
    expect(sql.match(/create or replace function public\.(\w+)\(/g)).toEqual([
      'create or replace function public.claim_next_embedding_job(',
      'create or replace function public.store_chunk_embeddings(',
      'create or replace function public.complete_embedding_job(',
      'create or replace function public.fail_embedding_job(',
    ])
  })

  it('only adds next_attempt_at to the jobs table; no other table changes', () => {
    expect(sql.match(/alter table public\.\w+/g)).toEqual([
      'alter table public.paper_embedding_jobs',
    ])
    expect(sql).toMatch(/add column next_attempt_at timestamptz;/)
    expect(sql).not.toMatch(/\b(drop|truncate)\b/i)
    expect(sql).not.toMatch(/create table/i)
  })

  it('creates no vector index (HNSW / IVFFlat)', () => {
    expect(sql).not.toMatch(/hnsw|ivfflat|create index/i)
  })

  it('pins search_path on every function', () => {
    expect(sql.match(/set search_path = /g)).toHaveLength(4)
    expect(fn('store_chunk_embeddings')).toMatch(
      /set search_path = extensions, pg_temp/,
    )
  })
})

describe('migration 0007: claim_next_embedding_job', () => {
  const claim = fn('claim_next_embedding_job')

  it('claims one job at a time with FOR UPDATE SKIP LOCKED', () => {
    expect(claim).toMatch(/limit 1\s+for update of j skip locked/)
    expect(claim).toMatch(/set status = 'embedding'/)
    expect(claim).toMatch(/attempts = j\.attempts \+ 1/)
    expect(claim).toMatch(/claim_started_at = clock_timestamp\(\)/)
  })

  it('works on the active profile only', () => {
    expect(claim).toMatch(
      /from public\.embedding_models m\s+where m\.status = 'active'/,
    )
    expect(claim).toMatch(/if v_model is null then\s+return;/)
    expect(claim).toMatch(/j\.model_id = v_model/)
  })

  it('automatically backfills ready papers that have chunks and no job', () => {
    expect(claim).toMatch(/insert into public\.paper_embedding_jobs/)
    expect(claim).toMatch(/p\.status = 'ready'/)
    expect(claim).toMatch(/p\.processing_completed_at is not null/)
    expect(claim).toMatch(
      /exists \(select 1 from public\.paper_chunks c where c\.paper_id = p\.id\)/,
    )
    expect(claim).toMatch(
      /not exists \(\s*select 1 from public\.paper_embedding_jobs j/,
    )
    expect(claim).toMatch(/on conflict \(paper_id, model_id\) do nothing/)
  })

  it('never claims a job for a non-ready paper or an out-of-date generation', () => {
    expect(claim).toMatch(
      /join public\.papers p on p\.id = j\.paper_id[\s\S]*and p\.status = 'ready'\s+and j\.source_completed_at = p\.processing_completed_at/,
    )
  })

  it('resets a job when the paper was reprocessed, clearing its claim (fencing old workers)', () => {
    expect(claim).toMatch(
      /j\.source_completed_at is distinct from p\.processing_completed_at/,
    )
    const reset = claim.slice(
      claim.indexOf("set status = 'pending'"),
      claim.indexOf('and j.source_completed_at is distinct'),
    )
    for (const cleared of [
      'attempts = 0',
      'claim_started_at = null',
      'chunk_count = null',
      'embedded_count = 0',
      'last_error = null',
      'next_attempt_at = null',
    ]) {
      expect(reset).toContain(cleared)
    }
    expect(reset).toMatch(/source_completed_at = p\.processing_completed_at/)
  })

  it('recovers stalled jobs by row activity, bounds attempts, and honors retry backoff', () => {
    expect(claim).toMatch(
      /j\.status = 'embedding' and j\.updated_at < now\(\) - p_stale_after/,
    )
    expect(claim).toMatch(/j\.attempts < p_max_attempts/)
    expect(claim).toMatch(
      /j\.next_attempt_at is null or j\.next_attempt_at <= now\(\)/,
    )
    expect(claim).toMatch(
      /set status = 'failed'[\s\S]*j\.attempts >= p_max_attempts/,
    )
    expect(claim).toMatch(
      /'Indexing was interrupted repeatedly and was stopped\.'/,
    )
  })

  it('can be restricted to a single paper (so a manual run cannot backfill the library)', () => {
    expect(claim).toMatch(/p_paper_id uuid default null/)
    expect(
      claim.match(/p_paper_id is null or /g)?.length,
    ).toBeGreaterThanOrEqual(4)
  })

  it('returns the profile so the worker can refuse a mismatch', () => {
    expect(claim).toMatch(
      /m\.provider, m\.provider_model, m\.dimensions, m\.input_profile/,
    )
  })

  it('does not touch papers, chunks or PDF processing', () => {
    expect(claim).not.toMatch(
      /\b(update|insert into|delete from)\s+public\.(papers|paper_chunks|paper_sections|chunk_embeddings)\b/,
    )
  })
})

describe('migration 0007: store_chunk_embeddings (ownership + fencing)', () => {
  const store = fn('store_chunk_embeddings')

  it('is fenced by the claim token, the paper generation, ready status and the active profile', () => {
    expect(store).toMatch(/j\.status = 'embedding'/)
    expect(store).toMatch(/j\.claim_started_at = p_claim_started_at/)
    expect(store).toMatch(/p\.status = 'ready'/)
    expect(store).toMatch(/j\.source_completed_at = p\.processing_completed_at/)
    expect(store).toMatch(/m\.status = 'active'/)
    expect(store).toMatch(/for update of j;\s+if not found then\s+return -1;/)
  })

  it('takes ownership from the job row, never from the payload', () => {
    expect(store).toMatch(/select j\.user_id\s+into v_user_id/)
    expect(store).toMatch(/p_paper_id, v_user_id/)
    expect(store).not.toMatch(/x\.user_id|x\.paper_id/)
    expect(store).toMatch(
      /as x\(chunk_id uuid, embedding jsonb, content_hash text\)/,
    )
  })

  it('casts the JSON number array to vector(1024) (wrong length or type is rejected)', () => {
    expect(store).toMatch(/\(x\.embedding::text\)::vector\(1024\)/)
    expect(sql.match(/vector\(\d+\)/g)).toEqual(['vector(1024)'])
  })

  it('upserts so a chunk with changed text is re-embedded, and refreshes the job heartbeat', () => {
    expect(store).toMatch(/on conflict \(chunk_id, model_id\) do update/)
    expect(store).toMatch(/content_hash = excluded\.content_hash/)
    expect(store).toMatch(
      /update public\.paper_embedding_jobs j\s+set embedded_count = v_stored/,
    )
  })

  it('bounds the batch size', () => {
    expect(store).toMatch(/jsonb_array_length\(p_rows\) not between 1 and 200/)
  })
})

describe('migration 0007: complete_embedding_job and fail_embedding_job', () => {
  it('completes only when every chunk has an embedding with a content hash', () => {
    const complete = fn('complete_embedding_job')
    expect(complete).toMatch(/j\.claim_started_at = p_claim_started_at/)
    expect(complete).toMatch(
      /j\.source_completed_at = p\.processing_completed_at/,
    )
    expect(complete).toMatch(/ce\.content_hash is not null/)
    expect(complete).toMatch(
      /if v_chunks = 0 or v_embedded <> v_chunks then\s+raise exception/,
    )
    expect(complete.indexOf('raise exception')).toBeLessThan(
      complete.indexOf("set status = 'complete'"),
    )
    expect(complete).toMatch(/claim_started_at = null/)
  })

  it('fail: fenced; retry goes back to pending with a delay and can refund the attempt', () => {
    const fail = fn('fail_embedding_job')
    expect(fail).toMatch(/j\.claim_started_at = p_claim_started_at/)
    expect(fail).toMatch(/if p_retry then[\s\S]*set status = 'pending'/)
    expect(fail).toMatch(/next_attempt_at = now\(\) \+ p_retry_delay/)
    expect(fail).toMatch(
      /case when p_count_attempt then j\.attempts\s+else greatest\(j\.attempts - 1, 0\) end/,
    )
    expect(fail).toMatch(/set status = 'failed'/)
    expect(fail).toMatch(/left\(nullif\(trim\(p_error\), ''\), 1000\)/)
  })

  it('never touches papers.status (PDF lifecycle stays independent)', () => {
    for (const name of [
      'claim_next_embedding_job',
      'store_chunk_embeddings',
      'complete_embedding_job',
      'fail_embedding_job',
    ]) {
      const body = fn(name)
      expect(body, name).not.toMatch(/update public\.papers\b/)
      expect(body, name).not.toMatch(/insert into public\.papers\b/)
    }
    expect(sql).not.toMatch(/'uploaded'|'processing'/)
  })
})

describe('migration 0007: grants (service role only)', () => {
  const signatures = [
    'claim_next_embedding_job\\(uuid, int, interval\\)',
    'store_chunk_embeddings\\(uuid, text, timestamptz, jsonb\\)',
    'complete_embedding_job\\(uuid, text, timestamptz\\)',
    'fail_embedding_job\\(uuid, text, timestamptz, text, boolean, boolean, interval\\)',
  ]

  it.each(signatures)(
    '%s is revoked from browser roles and granted to service_role only',
    (signature) => {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${signature}\\s+from public, anon, authenticated;`,
        ),
      )
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${signature} to service_role;`,
        ),
      )
    },
  )

  it('grants nothing to browser roles and does not expose next_attempt_at', () => {
    expect(sql).not.toMatch(/grant[^;]*\bto\b[^;]*(anon|authenticated)/)
    expect(sql).not.toMatch(/create policy/)
    expect(sql).not.toMatch(/grant select \(/)
  })

  it('leaves the browser-facing column grant from 0006 without next_attempt_at', () => {
    const grant = read('0006_vector_foundation.sql').match(
      /grant select \(([^)]*)\) on public\.paper_embedding_jobs to authenticated;/,
    )
    expect(grant).not.toBeNull()
    expect(grant![1]).not.toContain('next_attempt_at')
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
  }
  it.each(Object.entries(pinned))('%s is unchanged', (name, hash) => {
    expect(createHash('sha256').update(read(name)).digest('hex')).toBe(hash)
  })
})
