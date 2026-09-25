import { getSupabaseBrowserClient } from '#/lib/supabase/client'

export type ProjectRole = 'OWNER' | 'EDITOR' | 'VIEWER'
export type ProjectMember = {
  project_id: string
  user_id: string
  role: ProjectRole
  joined_at: string
  profile?: { full_name: string | null } | null
}
export type ProjectActivity = { id: number; actor_name: string | null; event_type: string; metadata: Record<string, unknown>; created_at: string }

export async function getProjectRole(projectId: string): Promise<ProjectRole | null> {
  const { data, error } = await getSupabaseBrowserClient().rpc('project_role', { p_project_id: projectId })
  if (error) throw error
  return (data as ProjectRole | null) ?? null
}

export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('project_members')
    .select('project_id, user_id, role, joined_at, profiles(full_name)')
    .eq('project_id', projectId)
    .order('joined_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row: unknown) => {
    const value = row as ProjectMember & { profiles?: { full_name: string | null } | null }
    return { ...value, profile: value.profiles, profiles: undefined }
  })
}

export async function inviteProjectMember(input: { projectId: string; email: string; role: Exclude<ProjectRole, 'OWNER'> }) {
  const { data, error } = await getSupabaseBrowserClient().rpc('create_project_invitation', {
    p_project_id: input.projectId, p_email: input.email, p_role: input.role,
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as { invitation_id: string; invitation_token: string }
  return {
    id: row.invitation_id,
    link: `${window.location.origin}/invite?token=${encodeURIComponent(row.invitation_token)}`,
  }
}

export async function acceptProjectInvitation(token: string): Promise<string> {
  const { data, error } = await getSupabaseBrowserClient().rpc('accept_project_invitation', { p_token: token })
  if (error) throw error
  return data as string
}

export async function changeProjectMemberRole(projectId: string, userId: string, role: Exclude<ProjectRole, 'OWNER'>) {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase.from('project_members').update({ role }).eq('project_id', projectId).eq('user_id', userId)
  if (error) throw error
  await supabase.rpc('log_project_activity', { p_project_id: projectId, p_event_type: 'member_role_changed', p_metadata: { user_id: userId, role } })
}

export async function removeProjectMember(projectId: string, userId: string) {
  const supabase = getSupabaseBrowserClient()
  const { error } = await supabase.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId)
  if (error) throw error
  await supabase.rpc('log_project_activity', { p_project_id: projectId, p_event_type: 'member_removed', p_metadata: { user_id: userId } })
}

export async function listProjectActivity(projectId: string): Promise<ProjectActivity[]> {
  const { data, error } = await getSupabaseBrowserClient().from('project_activity').select('id, actor_name, event_type, metadata, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(30)
  if (error) throw error
  return (data ?? []) as ProjectActivity[]
}
