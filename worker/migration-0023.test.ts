import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/0023_document_intelligence.sql'),
  'utf8',
)

describe('R12 document intelligence migration', () => {
  it('adds classification/quality columns to papers without touching existing ones', () => {
    expect(sql).toMatch(/alter table public\.papers\s*\n\s*add column document_type text/)
    expect(sql).toMatch(/add column extraction_quality text/)
    expect(sql).not.toMatch(/drop column/i)
  })

  it('creates paper_pages, paper_tables and paper_facts with paper_id + user_id ownership', () => {
    for (const table of ['paper_pages', 'paper_tables', 'paper_facts']) {
      expect(sql).toMatch(new RegExp(`create table public\\.${table}`))
      expect(sql).toMatch(
        new RegExp(
          `${table}[\\s\\S]*?foreign key \\(paper_id, user_id\\)\\s*\\n\\s*references public\\.papers`,
        ),
      )
    }
  })

  it('enables RLS and only grants select to authenticated for every new table', () => {
    for (const table of ['paper_pages', 'paper_tables', 'paper_facts']) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`))
    }
    expect(sql).toMatch(/revoke all on public\.paper_pages, public\.paper_tables, public\.paper_facts\s+from anon, authenticated/)
    expect(sql).toMatch(/grant select on public\.paper_pages, public\.paper_tables, public\.paper_facts to authenticated/)
    expect(sql).toMatch(/grant select, insert, update, delete\s*\n\s*on public\.paper_pages, public\.paper_tables, public\.paper_facts to service_role/)
  })

  it('reuses can_view_paper for collaborator-aware reads, matching the R10 pattern', () => {
    expect(sql.match(/using \(public\.can_view_paper\(paper_id\)\)/g)?.length).toBe(3)
  })

  it('never grants write access to anon/authenticated on the new tables', () => {
    expect(sql).not.toMatch(/grant insert on public\.paper_(pages|tables|facts) to authenticated/)
    expect(sql).not.toMatch(/grant update on public\.paper_(pages|tables|facts) to authenticated/)
  })

  it('adds source_kind to paper_chunks constrained to text/table/fact', () => {
    expect(sql).toMatch(
      /add column source_kind text not null default 'text'\s*\n\s*check \(source_kind in \('text', 'table', 'fact'\)\)/,
    )
  })

  it('links a table-sourced chunk back to its table within the same paper', () => {
    expect(sql).toMatch(
      /foreign key \(source_table_id, paper_id\)\s*\n\s*references public\.paper_tables/,
    )
  })

  it('links a table-sourced fact back to its table within the same paper', () => {
    expect(sql).toMatch(
      /foreign key \(table_id, paper_id\)\s*\n\s*references public\.paper_tables/,
    )
  })

  it('keeps complete_paper_processing fenced by processing_started_at and idempotent on retry', () => {
    expect(sql).toMatch(/p\.processing_started_at = p_started_at/)
    expect(sql).toMatch(/delete from public\.paper_pages pg where pg\.paper_id = p_paper_id/)
    expect(sql).toMatch(/delete from public\.paper_tables t where t\.paper_id = p_paper_id/)
    expect(sql).toMatch(/delete from public\.paper_facts f where f\.paper_id = p_paper_id/)
  })

  it('clears R12 derived rows on failure too, whether retried or not', () => {
    const failFn = sql.slice(sql.indexOf('function public.fail_paper_processing'))
    expect(failFn).toMatch(/delete from public\.paper_pages/)
    expect(failFn).toMatch(/delete from public\.paper_tables/)
    expect(failFn).toMatch(/delete from public\.paper_facts/)
  })

  it('restricts both RPCs to the service role only', () => {
    expect(sql).toMatch(
      /revoke all on function public\.complete_paper_processing\([\s\S]*?\)\s*\n\s*from public, anon, authenticated/,
    )
    expect(sql).toMatch(
      /grant execute on function public\.complete_paper_processing\([\s\S]*?\) to service_role/,
    )
    expect(sql).toMatch(
      /revoke all on function public\.fail_paper_processing\(uuid, timestamptz, text, boolean, text\)\s*\n\s*from public, anon, authenticated/,
    )
  })

  it('drops the superseded function overloads so the worker cannot call a stale signature', () => {
    expect(sql).toMatch(
      /drop function if exists public\.complete_paper_processing\(uuid, timestamptz, int, jsonb, jsonb\);/,
    )
    expect(sql).toMatch(
      /drop function if exists public\.fail_paper_processing\(uuid, timestamptz, text, boolean\);/,
    )
  })

  it('never disables RLS or widens an existing policy', () => {
    expect(sql).not.toMatch(/disable row level security/i)
    expect(sql).not.toMatch(/drop policy/i)
  })

  it('is wrapped in a single transaction', () => {
    expect(sql.trim().startsWith('-- R12')).toBe(true)
    expect(sql).toMatch(/^begin;/m)
    expect(sql.trim().endsWith('commit;')).toBe(true)
  })
})
