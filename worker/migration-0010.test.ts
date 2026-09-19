import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Design-level checks on migration 0010 (Evidence Matrix request queue + worker
 * functions). Runtime behavior is verified against Postgres by
 * supabase/verification/0010_evidence_worker_checks.sql.
 */
const read = (name: string) =>
  readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n')

const sql = read('0010_evidence_matrix_worker.sql').replace(/--.*$/gm, '')
const fn = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return sql.slice(start, sql.indexOf('\n$$;', sql.indexOf('as $$', start)))
}

describe('migration 0010: shape', () => {
  it('is one transaction adding no tables and touching no 0009 object except one function', () => {
    expect(sql.trimStart().startsWith('begin;')).toBe(true)
    expect(sql.trimEnd().endsWith('commit;')).toBe(true)
    expect(sql).not.toMatch(/create table|alter table|drop /i)
    const created = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map(
      (m) => m[1],
    )
    expect(created).toEqual([
      'request_paper_extraction',
      'claim_next_paper_extraction',
      'retry_paper_extraction',
      'complete_paper_extraction',
    ])
  })

  it('adds no stored stale status and pins search_path on every function', () => {
    expect(sql).not.toMatch(/'stale'/)
    expect((sql.match(/set search_path = ''/g) ?? []).length).toBe(4)
  })
})

describe('migration 0010: request_paper_extraction (browser entry point)', () => {
  const f = fn('request_paper_extraction')

  it('takes ONLY the paper id', () => {
    expect(f).toMatch(/request_paper_extraction\(p_paper_id uuid\)\s+returns text/)
    expect(f).not.toMatch(/p_user|p_provider|p_model|p_attempts|p_status|p_source|p_claim|p_error|p_schema/)
  })

  it('is SECURITY DEFINER with a pinned search_path and derives the caller from auth.uid()', () => {
    expect(f).toMatch(/security definer\s+set search_path = ''/)
    expect(f).toMatch(/v_uid uuid := \(select auth\.uid\(\)\)/)
    expect(f).toMatch(/if v_uid is null then\s+raise exception 'not authenticated'/)
  })

  it('verifies ownership, ready status and a processing generation', () => {
    expect(f).toMatch(/p\.id = p_paper_id and p\.user_id = v_uid/)
    expect(f).toMatch(/if v_status <> 'ready' or v_generation is null then\s+return 'not_ready'/)
    // a missing paper and someone else's paper are indistinguishable
    expect(f).toMatch(/if not found then\s+return 'not_found'/)
  })

  it('fixes schema version 1, the owner and the generation internally', () => {
    expect(f).toMatch(/values \(p_paper_id, 1, v_uid, v_generation\)/)
    expect(f).toMatch(/e\.schema_version = 1/)
  })

  it('is concurrency-safe: conflict-free insert, then a row lock, paper protected from deletion', () => {
    expect(f).toMatch(/for key share;/)
    const insert = f.indexOf('insert into public.paper_extractions')
    const lock = f.indexOf('for update;')
    expect(insert).toBeGreaterThan(-1)
    expect(lock).toBeGreaterThan(insert)
    expect(f).toMatch(/on conflict \(paper_id, schema_version\) do nothing/)
    expect(f).not.toMatch(/exception when unique_violation/i)
  })

  it('resets the attempt budget only for failed/partial/older-generation rows, never pending/running/complete', () => {
    const noop = f.indexOf("return 'unchanged'")
    const reset = f.indexOf('attempts = 0')
    expect(noop).toBeGreaterThan(-1)
    expect(reset).toBeGreaterThan(noop)
    expect(f.match(/attempts = 0/g)).toHaveLength(1)
  })

  it('is idempotent: pending / running / current-complete are no-ops', () => {
    expect(f).toMatch(
      /e_generation is not distinct from v_generation\s+and e_status in \('pending', 'running', 'complete'\) then\s+return 'unchanged'/,
    )
    expect(f).toMatch(/on conflict \(paper_id, schema_version\) do nothing/)
    expect(f).toMatch(/for update;/)
  })

  it('re-queues failed/partial and older generations without deleting or re-stamping anything', () => {
    const update = f.slice(f.indexOf('update public.paper_extractions'))
    expect(update).toMatch(/set status = 'pending',\s+attempts = 0,\s+claim_started_at = null,\s+completed_at = null,\s+last_error = null/)
    expect(update).not.toMatch(/source_completed_at|provider|model|user_id/)
    expect(f).not.toMatch(/delete from/i)
  })

  it('is executable by authenticated only', () => {
    expect(sql).toMatch(
      /revoke all on function public\.request_paper_extraction\(uuid\)\s+from public, anon, authenticated;/,
    )
    expect(sql).toMatch(
      /grant execute on function public\.request_paper_extraction\(uuid\) to authenticated;/,
    )
    expect(sql).not.toMatch(/request_paper_extraction\(uuid\) to (service_role|anon|public)/)
  })
})

describe('migration 0010: worker functions', () => {
  it('claim_next only considers requested (pending) or abandoned rows of ready papers', () => {
    const f = fn('claim_next_paper_extraction')
    expect(f).toMatch(/p\.status = 'ready'/)
    expect(f).toMatch(/p\.processing_completed_at is not null/)
    expect(f).toMatch(/e\.status = 'pending'\s+or \(e\.status = 'running'/)
    expect(f).toMatch(/e\.attempts < p_max_attempts/)
    expect(f).toMatch(/for update of e skip locked/)
    // never creates work: rows only come from request_paper_extraction
    expect(f).not.toMatch(/insert into/i)
    // claims through the fenced 0009 function
    expect(f).toMatch(/from public\.claim_paper_extraction\(v_paper, p_schema_version, p_stale_after\)/)
  })

  it('claim_next fails an exhausted abandoned run instead of reclaiming it', () => {
    const f = fn('claim_next_paper_extraction')
    expect(f).toMatch(/set status = 'failed'[^;]*where e\.schema_version = p_schema_version\s+and e\.status = 'running'\s+and e\.updated_at < now\(\) - p_stale_after\s+and e\.attempts >= p_max_attempts/s)
  })

  it('retry is fenced by the claim token and only leaves running', () => {
    const f = fn('retry_paper_extraction')
    expect(f).toMatch(/e\.status = 'running'\s+and e\.claim_started_at = p_claim_started_at/)
    expect(f).toMatch(/set status = 'pending'/)
    expect(f).not.toMatch(/attempts\s*=/)
    expect(f).not.toMatch(/delete from/i)
  })

  it('complete allows NULL provider/model only when no field was extracted or failed', () => {
    const f = fn('complete_paper_extraction')
    expect(sql).toMatch(
      /complete_paper_extraction\(\s*p_paper_id uuid,\s*p_schema_version int,\s*p_claim_started_at timestamptz,\s*p_provider text,\s*p_model text\s*\)\s*returns text/,
    )
    expect(f).toMatch(/if \(p_provider is null\) <> \(p_model is null\) then/)
    // NULL/NULL needs all seven fields, all not_reported
    expect(f).toMatch(
      /if v_provider is null and \(v_fields <> 7 or v_failed > 0 or v_extracted > 0\) then/,
    )
    // an LLM run needs non-blank, trimmed provider and model
    expect(f).toMatch(/p_provider !~ '\\S' or p_model !~ '\\S'/)
    expect(f).toMatch(/v_provider := left\(btrim\(p_provider/)
    expect(f).toMatch(/provider = v_provider,\s+model = v_model/)
    // only fields written by THIS claim can make an extraction complete
    expect(f).toMatch(/f\.created_at >= p_claim_started_at/)
    expect(f).toMatch(
      /v_fields = 7 and v_failed = 0 and v_this_run = 7\s+then 'complete' else 'partial'/,
    )
    // fencing and generation check are preserved
    expect(f).toMatch(/e\.claim_started_at = p_claim_started_at/)
    expect(f).toMatch(/e\.source_completed_at = p\.processing_completed_at/)
  })

  it('worker functions are service_role only', () => {
    for (const sig of [
      'claim_next_paper_extraction\\(int, int, interval\\)',
      'retry_paper_extraction\\(uuid, int, timestamptz\\)',
      'complete_paper_extraction\\(uuid, int, timestamptz, text, text\\)',
    ]) {
      expect(sql).toMatch(
        new RegExp(`revoke all on function public\\.${sig}\\s+from public, anon, authenticated;`),
      )
      expect(sql).toMatch(
        new RegExp(`grant execute on function public\\.${sig} to service_role;`),
      )
      expect(sql).not.toMatch(
        new RegExp(`grant execute on function public\\.${sig} to (authenticated|anon|public)`),
      )
    }
  })
})
