import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  requireProjectEditor,
  requireProjectViewer,
} from './authorization.server'

function client(role: 'OWNER' | 'EDITOR' | 'VIEWER' | null) {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'actor-1' } },
        error: null,
      })),
    },
    rpc: vi.fn(async () => ({ data: role, error: null })),
  }
}

describe('project feature authorization', () => {
  it.each(['OWNER', 'EDITOR', 'VIEWER'] as const)(
    'allows %s to use read-only research search',
    async (role) => {
      const supabase = client(role)
      await expect(
        requireProjectViewer(supabase as never, 'project-1'),
      ).resolves.toEqual({ actorUserId: 'actor-1', role })
      expect(supabase.rpc).toHaveBeenCalledWith('project_role', {
        p_project_id: 'project-1',
      })
    },
  )

  it('denies non-members without revealing whether the project exists', async () => {
    await expect(
      requireProjectViewer(client(null) as never, 'project-1'),
    ).rejects.toThrow('could not be found')
  })

  it('keeps Editor authorization on mutating research features', async () => {
    await expect(
      requireProjectEditor(client('VIEWER') as never, 'project-1'),
    ).rejects.toThrow('Editor access')
  })

  it('binds both semantic search and Research Chat to Viewer authorization', () => {
    for (const path of [
      'src/features/search/search.functions.ts',
      'src/features/chat/ask.functions.ts',
    ]) {
      const source = readFileSync(join(process.cwd(), path), 'utf8')
      expect(source).toMatch(/requireProjectViewer\(supabase, projectId\)/)
      expect(source).not.toMatch(/requireProjectEditor\(supabase, projectId\)/)
    }
  })
})
