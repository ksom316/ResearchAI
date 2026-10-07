import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import type { ResearchProject } from './types'
import { getProjectRole } from './collaboration'

const COLUMNS = 'id, title, description, created_at, updated_at'

export type ProjectInput = { title: string; description?: string | null }

export async function listProjects(limit?: number): Promise<ResearchProject[]> {
  let query = getSupabaseBrowserClient()
    .from('research_projects')
    .select(COLUMNS)
    .order('updated_at', { ascending: false })
  if (limit) query = query.limit(limit)
  const { data, error } = await query
  if (error) throw error
  return Promise.all((data as ResearchProject[]).map(async (project) => ({ ...project, role: await getProjectRole(project.id) ?? undefined })))
}

export async function getProject(id: string): Promise<ResearchProject | null> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('research_projects')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? { ...(data as ResearchProject), role: await getProjectRole(id) ?? undefined } : null
}

export async function createProject(
  input: ProjectInput,
): Promise<ResearchProject> {
  const supabase = getSupabaseBrowserClient()

  // research_projects.user_id defaults to auth.uid() in the database, but
  // every other insert in this app (see uploadPaper in papers/api.ts)
  // resolves the authenticated user explicitly and sends user_id rather than
  // relying on that default - this was the one insert that didn't, and it is
  // the one that failed its own "user_id = auth.uid()" RLS check in
  // production. Matching the established, working pattern removes any
  // dependency on the column default being evaluated the same way the
  // policy check is for this request.
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    throw new Error('Your session has expired. Please sign in again.')
  }

  const { data, error } = await supabase
    .from('research_projects')
    .insert({
      user_id: userData.user.id,
      title: input.title.trim(),
      description: input.description?.trim() || null,
    })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as ResearchProject
}

export async function updateProject(
  id: string,
  input: ProjectInput,
): Promise<ResearchProject> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('research_projects')
    .update({
      title: input.title.trim(),
      description: input.description?.trim() || null,
    })
    .eq('id', id)
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as ResearchProject
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await getSupabaseBrowserClient()
    .from('research_projects')
    .delete()
    .eq('id', id)
  if (error) throw error
}
