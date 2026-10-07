import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/0024_collaboration_v2.sql'),
  'utf8',
)

const NEW_TABLES = [
  'discussions',
  'comments',
  'mentions',
  'assignments',
  'notes',
  'notifications',
] as const

describe('R13 collaboration migration', () => {
  it('creates every new table exactly once', () => {
    for (const table of NEW_TABLES) {
      const matches = sql.match(new RegExp(`create table public\\.${table}\\b`, 'g'))
      expect(matches?.length).toBe(1)
    }
  })

  it('enables RLS on every new table', () => {
    for (const table of NEW_TABLES) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`))
    }
  })

  it('grants select but never insert/update/delete to authenticated on any new table', () => {
    expect(sql).toMatch(
      /revoke all on public\.discussions, public\.comments, public\.mentions,\s*\n\s*public\.assignments, public\.notes, public\.notifications\s*\n\s*from anon, authenticated/,
    )
    expect(sql).toMatch(
      /grant select on public\.discussions, public\.comments, public\.mentions,\s*\n\s*public\.assignments, public\.notes, public\.notifications to authenticated/,
    )
    expect(sql).not.toMatch(/grant insert on public\.(discussions|comments|mentions|assignments|notes|notifications) to authenticated/)
    expect(sql).not.toMatch(/grant update on public\.(discussions|comments|mentions|assignments|notes|notifications) to authenticated/)
  })

  it('scopes every select policy to can_view_project, except notifications which are recipient-only', () => {
    expect(sql.match(/using \(public\.can_view_project\(project_id\)\)/g)?.length).toBe(5)
    expect(sql).toMatch(
      /create policy "Recipients read own notifications" on public\.notifications\s*\n\s*for select to authenticated using \(recipient_id = \(select auth\.uid\(\)\)\)/,
    )
  })

  it('extends (not replaces) the existing project_activity event_type vocabulary', () => {
    expect(sql).toMatch(/alter table public\.project_activity drop constraint project_activity_event_type_check/)
    for (const existing of ['member_invited', 'paper_added', 'ai_feature_invoked']) {
      expect(sql).toContain(`'${existing}'`)
    }
    for (const added of [
      'comment_created', 'discussion_resolved', 'discussion_reopened',
      'user_mentioned', 'assignment_created', 'assignment_completed',
      'note_created', 'note_updated',
    ]) {
      expect(sql).toContain(`'${added}'`)
    }
  })

  it('validates a discussion target is linked to its project before insert', () => {
    expect(sql).toMatch(/create trigger discussions_validate_target\s*\n\s*before insert on public\.discussions/)
    expect(sql).toMatch(/paper_project_links l\s*\n\s*where l\.paper_id = new\.paper_id and l\.project_id = new\.project_id/)
  })

  it('validates a mentioned user is a project member before insert', () => {
    expect(sql).toMatch(/create trigger mentions_validate before insert on public\.mentions/)
    expect(sql).toMatch(/project_members pm\s*\n\s*where pm\.project_id = new\.project_id and pm\.user_id = new\.mentioned_user_id/)
  })

  it('validates an assignee is a project member inside create_assignment', () => {
    const fn = sql.slice(sql.indexOf('function public.create_assignment'))
    expect(fn).toMatch(/assignee_not_a_project_member/)
  })

  it('keeps every write path behind a SECURITY DEFINER function with its own authorization check', () => {
    const functions = [
      'create_discussion', 'add_comment', 'edit_comment', 'delete_comment',
      'resolve_discussion', 'reopen_discussion', 'create_assignment',
      'update_assignment_status', 'create_note', 'update_note',
      'mark_notification_read', 'mark_all_notifications_read',
    ]
    for (const fn of functions) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${fn}\\(`))
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`))
    }
  })

  it('never grants execute on the internal mention fan-out helper to authenticated', () => {
    expect(sql).not.toMatch(/grant execute on function public\.create_mentions_and_notify[^\n]*to authenticated/)
  })

  it('edit/delete comment are restricted to the comment author', () => {
    const edit = sql.slice(sql.indexOf('function public.edit_comment'))
    expect(edit).toMatch(/author_id = auth\.uid\(\)/)
    const del = sql.slice(sql.indexOf('function public.delete_comment'))
    expect(del).toMatch(/author_id = auth\.uid\(\)/)
  })

  it('resolve/reopen require project edit permission, not just view', () => {
    const resolve = sql.slice(
      sql.indexOf('function public.resolve_discussion'),
      sql.indexOf('function public.reopen_discussion'),
    )
    expect(resolve).toMatch(/can_edit_project/)
    const reopen = sql.slice(sql.indexOf('function public.reopen_discussion'))
    expect(reopen).toMatch(/can_edit_project/)
  })

  it('rejects a stale note update via an expected-revision check', () => {
    const fn = sql.slice(sql.indexOf('function public.update_note'))
    expect(fn).toMatch(/where id = p_note_id and revision = p_expected_revision/)
    expect(fn).toMatch(/note_revision_conflict/)
  })

  it('adds the new tables to the realtime publication idempotently', () => {
    expect(sql).toMatch(/pg_publication where pubname = 'supabase_realtime'/)
    expect(sql).toMatch(/pg_publication_tables/)
    for (const table of ['discussions', 'comments', 'notifications', 'assignments', 'notes', 'project_activity']) {
      expect(sql).toContain(`'${table}'`)
    }
  })

  it('never disables RLS, drops an existing policy, or grants broad write access', () => {
    expect(sql).not.toMatch(/disable row level security/i)
    expect(sql).not.toMatch(/drop policy/i)
    expect(sql).not.toMatch(/grant all/i)
  })

  it('is wrapped in a single transaction', () => {
    expect(sql).toMatch(/^begin;/m)
    expect(sql.trim().endsWith('commit;')).toBe(true)
  })
})
