import type { createSupabaseServerClient } from '#/lib/supabase/supabase.server'

type ServerSupabase = ReturnType<typeof createSupabaseServerClient>

export type ProjectRole = 'OWNER' | 'EDITOR' | 'VIEWER'

async function requireProjectRole(
  supabase: ServerSupabase,
  projectId: string,
  allowedRoles: readonly ProjectRole[],
  message: string,
) {
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) throw new Error('Authentication required.')
  const { data: role, error } = await supabase.rpc('project_role', {
    p_project_id: projectId,
  })
  if (error || !allowedRoles.includes(role as ProjectRole)) {
    throw new Error(message)
  }
  return { actorUserId: user.user.id, role: role as ProjectRole }
}

export async function requireProjectEditor(
  supabase: ServerSupabase,
  projectId: string,
) {
  const result = await requireProjectRole(
    supabase,
    projectId,
    ['OWNER', 'EDITOR'],
    'You need Editor access to use this research feature.',
  )
  return { ...result, role: result.role as 'OWNER' | 'EDITOR' }
}

/** Read-only research features are available to every project member. */
export function requireProjectViewer(
  supabase: ServerSupabase,
  projectId: string,
) {
  return requireProjectRole(
    supabase,
    projectId,
    ['OWNER', 'EDITOR', 'VIEWER'],
    'This project could not be found or you no longer have access to it.',
  )
}
