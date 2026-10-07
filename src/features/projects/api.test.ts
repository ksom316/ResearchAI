import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject } from './api'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  insertedRows: [] as Record<string, unknown>[],
}))

vi.mock('#/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  }),
}))

describe('createProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.insertedRows.length = 0
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.from.mockImplementation((table: string) => {
      expect(table).toBe('research_projects')
      return {
        insert: (row: Record<string, unknown>) => {
          mocks.insertedRows.push(row)
          return {
            select: () => ({
              single: async () => ({
                data: {
                  id: 'project-1',
                  title: row.title,
                  description: row.description,
                  created_at: '2026-09-25T00:00:00.000Z',
                  updated_at: '2026-09-25T00:00:00.000Z',
                },
                error: null,
              }),
            }),
          }
        },
      }
    })
  })

  // Regression for a production bug: the insert relied on
  // research_projects.user_id's `default auth.uid()` instead of resolving
  // the session explicitly, and failed its own "user_id = auth.uid()" RLS
  // check in production. user_id must now be sent explicitly, matching
  // every other insert in the app (see papers/api.ts's uploadPaper).
  it('resolves the authenticated user and sends user_id explicitly with the insert', async () => {
    const project = await createProject({ title: 'My project', description: 'A description' })

    expect(mocks.getUser).toHaveBeenCalledTimes(1)
    expect(mocks.insertedRows[0]).toMatchObject({
      user_id: 'user-1',
      title: 'My project',
      description: 'A description',
    })
    expect(project.id).toBe('project-1')
  })

  it('trims the title and turns a blank description into null', async () => {
    await createProject({ title: '  Spacey title  ', description: '   ' })
    expect(mocks.insertedRows[0]).toMatchObject({ title: 'Spacey title', description: null })
  })

  it('refuses to insert when the session cannot be resolved, without touching the database', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    await expect(createProject({ title: 'My project' })).rejects.toThrow(
      'Your session has expired. Please sign in again.',
    )
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('refuses to insert when auth.getUser() itself errors', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('network error') })
    await expect(createProject({ title: 'My project' })).rejects.toThrow(
      'Your session has expired. Please sign in again.',
    )
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
