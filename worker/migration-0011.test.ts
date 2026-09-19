import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Design-level checks on migration 0011 (explicit run marker) and on the verification
 * script that exposed the defect. Runtime behavior: supabase/verification/
 * 0010_evidence_worker_checks.sql (run after 0010 AND 0011).
 */
const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(
    /\r\n/g,
    '\n',
  )
const strip = (s: string) => s.replace(/--.*$/gm, '')

const m0009 = strip(read('supabase/migrations/0009_evidence_matrix_foundation.sql'))
const m0010 = strip(read('supabase/migrations/0010_evidence_matrix_worker.sql'))
const m0011 = strip(read('supabase/migrations/0011_evidence_matrix_worker_fix.sql'))
const verification = strip(read('supabase/verification/0010_evidence_worker_checks.sql'))

const fn = (sql: string, name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return sql.slice(start, sql.indexOf('\n$$;', sql.indexOf('as $$', start)))
}
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

describe('migration 0011: run marker', () => {
  it('adds ONE nullable timestamptz column to fields and nothing else structural', () => {
    expect(m0011.trimStart().startsWith('begin;')).toBe(true)
    expect(m0011.trimEnd().endsWith('commit;')).toBe(true)
    expect(m0011).toMatch(
      /alter table public\.paper_extraction_fields\s+add column claim_started_at timestamptz;/,
    )
    expect(m0011).not.toMatch(/create table|drop |not null;/i)
    expect((m0011.match(/alter table/g) ?? []).length).toBe(1)
    expect(
      [...m0011.matchAll(/create or replace function public\.(\w+)\(/g)].map((x) => x[1]),
    ).toEqual(['store_extraction_field', 'complete_paper_extraction'])
  })

  it('does not depend on timestamp inference: created_at is gone from completion', () => {
    const complete = fn(m0011, 'complete_paper_extraction')
    expect(complete).not.toMatch(/created_at|clock_timestamp/)
    expect(complete).toMatch(
      /count\(\*\) filter \(where f\.claim_started_at = p_claim_started_at\)::int/,
    )
    // the defect being fixed: 0010 compared created_at (transaction start) to the token
    expect(fn(m0010, 'complete_paper_extraction')).toMatch(/f\.created_at >= p_claim_started_at/)
  })

  it('store_extraction_field tags every written field with the exact claim token', () => {
    const store = fn(m0011, 'store_extraction_field')
    expect(store).toMatch(
      /\(paper_id, schema_version, field_key, user_id, state, value, claim_started_at\)\s+values \(p_paper_id, p_schema_version, p_field_key, v_user, p_state, p_value,\s+p_claim_started_at\)/,
    )
  })

  it('store_extraction_field is 0009 verbatim apart from the marker (no behavior drift)', () => {
    const original = fn(m0009, 'store_extraction_field')
    const expected = original
      .replace(
        '(paper_id, schema_version, field_key, user_id, state, value)',
        '(paper_id, schema_version, field_key, user_id, state, value, claim_started_at)',
      )
      .replace(
        'values (p_paper_id, p_schema_version, p_field_key, v_user, p_state, p_value);',
        'values (p_paper_id, p_schema_version, p_field_key, v_user, p_state, p_value,\n          p_claim_started_at);',
      )
    expect(squash(fn(m0011, 'store_extraction_field'))).toBe(squash(expected))
  })

  it('NULL provider/model requires exactly seven current-run not_reported fields', () => {
    const f = fn(m0011, 'complete_paper_extraction')
    expect(f).toMatch(/if \(p_provider is null\) <> \(p_model is null\) then/)
    expect(f).toMatch(
      /if v_provider is null\s+and \(v_fields <> 7 or v_this_run <> 7 or v_failed > 0 or v_extracted > 0\) then/,
    )
    expect(f).toMatch(/p_provider !~ '\\S' or p_model !~ '\\S'/)
    expect(f).toMatch(/v_provider := left\(btrim\(p_provider, E' \\t\\r\\n'\), 100\)/)
    expect(f).toMatch(
      /v_fields = 7 and v_failed = 0 and v_this_run = 7\s+then 'complete' else 'partial'/,
    )
    // fencing preserved
    expect(f).toMatch(/e\.claim_started_at = p_claim_started_at/)
    expect(f).toMatch(/e\.source_completed_at = p\.processing_completed_at/)
  })

  it('keeps privileges: service_role only, marker not granted to browsers', () => {
    for (const sig of [
      'store_extraction_field\\(uuid, int, timestamptz, text, text, jsonb, jsonb\\)',
      'complete_paper_extraction\\(uuid, int, timestamptz, text, text\\)',
    ]) {
      expect(m0011).toMatch(
        new RegExp(`revoke all on function public\\.${sig}\\s+from public, anon, authenticated;`),
      )
      expect(m0011).toMatch(new RegExp(`grant execute on function public\\.${sig} to service_role;`))
    }
    expect(m0011).not.toMatch(/to (authenticated|anon)/)
    // 0009's browser column grants are an explicit list that excludes the new column
    const grant = m0009.slice(m0009.indexOf('grant select (\n  paper_id, schema_version, field_key, state, value'))
    expect(grant.slice(0, grant.indexOf(';'))).not.toMatch(/claim_started_at/)
  })
})

describe('verification script (regression for the fixture defects)', () => {
  it('never calls claim_next_paper_extraction with a single argument', () => {
    // the first parameter is the SCHEMA VERSION; (3) meant "schema 3" and found nothing
    expect(verification).not.toMatch(/claim_next_paper_extraction\(\s*\d+\s*\)/)
    for (const call of verification.matchAll(/claim_next_paper_extraction\(([^)]*)\)/g)) {
      expect(call[1].split(',').length, call[0]).toBe(2)
    }
  })

  it('creates every claim through the worker function, never by editing status', () => {
    expect(verification).not.toMatch(/set status\s*=\s*'running'/i)
    expect(verification).not.toMatch(
      /update public\.paper_extractions\s+set[^;]*claim_started_at/i,
    )
  })

  it('checks the marker, the NULL invariants and generation fencing', () => {
    for (const phrase of [
      'every field carries the claim token',
      'NULL/NULL with missing fields refused',
      'NULL/NULL with a failed field refused',
      'NULL/NULL with an extracted field refused',
      'blank provider and model refused',
      'a field not written by this claim keeps the extraction partial',
      'generation change during a run',
      'exhausted abandoned run is failed',
    ]) {
      expect(verification, phrase).toContain(phrase)
    }
  })
})
