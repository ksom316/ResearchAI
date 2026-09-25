import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const sql = read('supabase/migrations/0013_usage_metering.sql').replace(/--.*$/gm, '')

describe('migration 0013: usage metering foundation', () => {
  it('creates append-only usage events with trusted attribution and idempotency', () => {
    expect(sql.trimStart().startsWith('begin;')).toBe(true)
    expect(sql.trimEnd().endsWith('commit;')).toBe(true)
    expect(sql).toMatch(/create table public\.usage_events/)
    expect(sql).toMatch(/actor_user_id uuid not null references auth\.users/)
    expect(sql).toMatch(/project_id uuid references public\.research_projects/)
    expect(sql).toMatch(/idempotency_key text not null unique/)
    expect(sql).toMatch(/metadata jsonb not null/)
  })

  it('does not grant browser writes and scopes summary to auth.uid()', () => {
    expect(sql).toMatch(/revoke all on public\.usage_events from anon, authenticated;/)
    expect(sql).toMatch(/grant select \([\s\S]*\) on public\.usage_events to authenticated;/)
    expect(sql).toMatch(/grant select, insert, update, delete on public\.usage_events to service_role;/)
    expect(sql).toMatch(/e\.actor_user_id = \(select auth\.uid\(\)\)/)
    expect(sql).not.toMatch(/p_user_id/)
  })

  it('counts only successful processing at the fenced completion boundary', () => {
    const complete = sql.slice(sql.indexOf('create or replace function public.complete_paper_processing'))
    expect(complete).toMatch(/where p\.id = p_paper_id[\s\S]*status = 'processing'/)
    expect(complete).toMatch(/update public\.papers p[\s\S]*status = 'ready'/)
    expect(complete).toMatch(/insert into public\.usage_events[\s\S]*'paper_processed'/)
    expect(complete).toMatch(/on conflict \(idempotency_key\) do nothing/)
    expect(sql).not.toMatch(/insert into public\.usage_events[\s\S]*fail_paper_processing/)
  })

  it('exposes only a read summary RPC to authenticated callers', () => {
    expect(sql).toMatch(/create or replace function public\.get_my_usage_summary\(/)
    expect(sql).toMatch(/revoke all on function public\.get_my_usage_summary\(timestamptz, timestamptz\)\s+from public, anon;/)
    expect(sql).toMatch(/grant execute on function public\.get_my_usage_summary\(timestamptz, timestamptz\)\s+to authenticated, service_role;/)
  })
})
