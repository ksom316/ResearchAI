import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const collaboration = readFileSync(
  join(process.cwd(), 'supabase/migrations/0014_project_collaboration.sql'),
  'utf8',
)
const fix = readFileSync(
  join(
    process.cwd(),
    'supabase/migrations/0022_fix_paper_insert_returning_policy.sql',
  ),
  'utf8',
)

describe('paper insert returning policy fix', () => {
  it('reproduces the helper-only R10 SELECT policy', () => {
    expect(collaboration).toMatch(
      /create policy "Users read authorized papers"[\s\S]*using \(public\.can_view_paper\(id\)\)/,
    )
  })

  it('uses a direct owner predicate for INSERT RETURNING', () => {
    expect(fix).toMatch(/user_id = \(select auth\.uid\(\)\)/)
  })

  it('preserves collaborator reads through project membership', () => {
    expect(fix).toMatch(/from public\.paper_project_links l/)
    expect(fix).toMatch(/l\.paper_id = papers\.id/)
    expect(fix).toMatch(/public\.can_view_project\(l\.project_id\)/)
  })

  it('does not broaden insert policy or remove reservation enforcement', () => {
    expect(fix).not.toMatch(/drop policy.*Users insert own papers/i)
    expect(fix).not.toMatch(/disable row level security/i)
    expect(fix).not.toMatch(
      /consume_storage_reservation|storage_reservation_id/,
    )
  })
})
