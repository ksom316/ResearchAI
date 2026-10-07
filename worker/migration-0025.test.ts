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
    'supabase/migrations/0025_fix_project_insert_returning_policy.sql',
  ),
  'utf8',
)

describe('research_projects insert returning policy fix', () => {
  it('reproduces the helper-only R10 SELECT policy this migration replaces', () => {
    expect(collaboration).toMatch(
      /create policy "Members read projects"[\s\S]*using \(public\.can_view_project\(id\)\)/,
    )
  })

  it('reproduces the AFTER INSERT trigger that only populates project_members after the row exists', () => {
    expect(collaboration).toMatch(
      /create trigger research_projects_seed_owner after insert on public\.research_projects/,
    )
  })

  it('drops and recreates exactly "Members read projects" - no other policy', () => {
    expect(fix).toMatch(/drop policy if exists "Members read projects" on public\.research_projects/)
    const createPolicies = fix.match(/create policy "[^"]+"/g) ?? []
    expect(createPolicies).toEqual(['create policy "Members read projects"'])
  })

  it('adds a direct owner predicate so a brand-new row is visible to its own INSERT RETURNING', () => {
    expect(fix).toMatch(/using \(\s*\n\s*user_id = \(select auth\.uid\(\)\)\s*\n\s*or public\.can_view_project\(id\)/)
  })

  it('preserves collaborator reads through project membership (does not narrow access)', () => {
    expect(fix).toMatch(/or public\.can_view_project\(id\)/)
  })

  it('does not touch insert/update/delete policies, grants, or RLS itself', () => {
    expect(fix).not.toMatch(/"Users create projects"/)
    expect(fix).not.toMatch(/"Owners update projects"/)
    expect(fix).not.toMatch(/"Owners delete projects"/)
    expect(fix).not.toMatch(/disable row level security/i)
    expect(fix).not.toMatch(/grant/i)
    expect(fix).not.toMatch(/revoke/i)
  })

  it('is wrapped in a single transaction', () => {
    expect(fix).toMatch(/^begin;/m)
    expect(fix.trim().endsWith('commit;')).toBe(true)
  })
})
