import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/0020_ai_usage_allowances.sql'),
  'utf8',
)

describe('AI usage allowances migration', () => {
  it('stores configurable defaults centrally and supports future profile assignment', () => {
    expect(sql).toMatch(/create table public\.ai_allowance_profiles/)
    expect(sql).toMatch(/values \('default', 100, 250000\)/)
    expect(sql).toMatch(/create table public\.user_ai_allowance_profiles/)
  })

  it('uses UTC monthly boundaries without reset jobs', () => {
    expect(sql).toMatch(/date_trunc\('month', now\(\) at time zone 'UTC'\)/)
    expect(sql).toMatch(/interval '1 month'/)
    expect(sql).not.toMatch(/cron|schedule/i)
  })

  it('counts successful requests but preserves real tokens from all provider outcomes', () => {
    expect(sql).toMatch(/metadata ->> 'outcome' = 'success'/)
    expect(sql).toMatch(/sum\(e\.total_tokens\)/)
    expect(sql).toMatch(/e\.total_tokens is not null/)
    expect(sql).not.toMatch(/coalesce\(e\.total_tokens, 0\)/)
  })

  it('scopes browser summaries to auth.uid and actor checks to service role', () => {
    expect(sql).toMatch(/get_my_ai_allowance\(\)[\s\S]*auth\.uid\(\)/)
    expect(sql).toMatch(
      /get_ai_allowance_for_actor\(uuid\)[\s\S]*to service_role/,
    )
    expect(sql).toMatch(
      /revoke all on public\.ai_allowance_profiles from public, anon, authenticated/,
    )
  })
})
