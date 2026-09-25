import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0014_project_collaboration.sql'), 'utf8')
const hooks = readFileSync(join(process.cwd(), 'supabase/migrations/0017_collaboration_activity_hooks.sql'), 'utf8')

describe('R10 project collaboration migrations', () => {
  it('backfills one canonical owner and defines the three roles', () => {
    expect(sql).toMatch(/create table public\.project_members/)
    expect(sql).toMatch(/check \(role in \('OWNER', 'EDITOR', 'VIEWER'\)\)/)
    expect(sql).toMatch(/select id, user_id, 'OWNER' from public\.research_projects/)
    expect(sql).toMatch(/create or replace function public\.can_view_project/)
    expect(sql).toMatch(/create or replace function public\.can_edit_project/)
  })

  it('binds invitations to both a hashed token and the authenticated email', () => {
    expect(sql).toMatch(/token_hash text not null unique/)
    expect(sql).toMatch(/digest\(v_token, 'sha256'\)/)
    expect(sql).toMatch(/v_inv\.recipient_email <> v_email/)
    expect(sql).toMatch(/cannot_invite_self/)
    expect(sql).toMatch(/pending_invitation_exists/)
  })

  it('scopes papers, links, derived data, storage, and search through membership', () => {
    expect(sql).toMatch(/Users read authorized papers/)
    expect(sql).toMatch(/Editors create paper links/)
    expect(sql).toMatch(/Members read paper sections/)
    expect(sql).toMatch(/Members read extractions/)
    expect(sql).toMatch(/Members read linked paper files/)
    expect(sql).toMatch(/public\.can_view_project\(l\.project_id\)/)
    expect(sql).toMatch(/public\.can_view_paper\(x\)/)
  })

  it('keeps collaboration activity operational and usage attribution actor-based', () => {
    expect(hooks).toMatch(/paper_added.*paper_removed/s)
    expect(hooks).toMatch(/new\.actor_user_id, 'ai_feature_invoked'/)
    expect(hooks).not.toMatch(/prompt|response/i)
  })
})
