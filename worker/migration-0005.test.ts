import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Design-level checks on the claim/complete/fail SQL. They can't prove runtime
 * behavior (that needs Postgres), but they pin the properties the worker relies
 * on so an accidental edit can't silently remove them.
 */
const sql = readFileSync(
  new URL('../supabase/migrations/0005_processing_worker.sql', import.meta.url),
  'utf8',
)

const fn = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  expect(start).toBeGreaterThan(-1)
  const end = sql.indexOf('$$;', sql.indexOf('as $$', start))
  return sql.slice(start, end)
}

describe('migration 0005', () => {
  it('claims one row at a time, skipping rows locked by another worker', () => {
    const claim = fn('claim_next_paper')
    expect(claim).toMatch(/limit 1\s+for update skip locked/)
    expect(claim).toMatch(/set status = 'processing'/)
    expect(claim).toMatch(/processing_attempts = p\.processing_attempts \+ 1/)
    expect(claim).toMatch(/processing_started_at = clock_timestamp\(\)/)
  })

  it('only claims uploaded papers or stale processing papers with attempts left', () => {
    const claim = fn('claim_next_paper')
    expect(claim).toMatch(/c\.processing_attempts < p_max_attempts/)
    expect(claim).toMatch(/c\.status = 'uploaded'/)
    expect(claim).toMatch(
      /c\.status = 'processing'\s+and c\.processing_started_at < now\(\) - p_stale_after/,
    )
    expect(claim).toMatch(/c\.storage_path is not null/)
  })

  it('fails abandoned jobs that are out of attempts instead of retrying forever', () => {
    const claim = fn('claim_next_paper')
    expect(claim).toMatch(/set status = 'failed'/)
    expect(claim).toMatch(/p\.processing_attempts >= p_max_attempts/)
  })

  it('fences completion and failure on the claim timestamp', () => {
    for (const name of ['complete_paper_processing', 'fail_paper_processing']) {
      const body = fn(name)
      expect(body).toMatch(/p\.status = 'processing'/)
      expect(body).toMatch(/p\.processing_started_at = p_started_at/)
      expect(body).toMatch(/for update/)
    }
  })

  it('replaces derived rows before inserting (idempotent) and takes ownership from the paper row', () => {
    const complete = fn('complete_paper_processing')
    expect(complete.indexOf('delete from public.paper_sections')).toBeLessThan(
      complete.indexOf('insert into public.paper_sections'),
    )
    expect(complete).toMatch(/v_user_id/)
    expect(complete).not.toMatch(/x\.user_id/)
    expect(complete).not.toMatch(/x\.paper_id/)
    // 'ready' is only set inside the same function, after the inserts.
    expect(complete.lastIndexOf("status = 'ready'")).toBeGreaterThan(
      complete.indexOf('insert into public.paper_chunks'),
    )
  })

  it('retries return to uploaded, and terminal failures clear derived data', () => {
    const failFn = fn('fail_paper_processing')
    expect(failFn).toMatch(/delete from public\.paper_sections/)
    expect(failFn).toMatch(/set status = 'uploaded'/)
    expect(failFn).toMatch(/set status = 'failed'/)
  })

  it('is callable only by the service role', () => {
    for (const signature of [
      'claim_next_paper\\(int, interval\\)',
      'complete_paper_processing\\(uuid, timestamptz, int, jsonb, jsonb\\)',
      'fail_paper_processing\\(uuid, timestamptz, text, boolean\\)',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function public\\.${signature}\\s+from public, anon, authenticated`,
        ),
      )
      expect(sql).toMatch(
        new RegExp(
          `grant execute on function public\\.${signature} to service_role`,
        ),
      )
    }
    expect(sql).not.toMatch(/grant execute[^;]*(anon|authenticated)/)
  })

  it('pins search_path on every function', () => {
    expect(sql.match(/set search_path = ''/g)).toHaveLength(3)
  })
})
