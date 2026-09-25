import type { createSupabaseServerClient } from '#/lib/supabase/supabase.server'

type ServerSupabase = ReturnType<typeof createSupabaseServerClient>

export async function requireProjectEditor(supabase: ServerSupabase, projectId: string) {
  const { data: user } = await supabase.auth.getUser()
  if (!user.user) throw new Error('Authentication required.')
  const { data: role, error } = await supabase.rpc('project_role', { p_project_id: projectId })
  if (error || (role !== 'OWNER' && role !== 'EDITOR')) throw new Error('You need Editor access to use this research feature.')
  return { actorUserId: user.user.id, role: role as 'OWNER' | 'EDITOR' }
}
