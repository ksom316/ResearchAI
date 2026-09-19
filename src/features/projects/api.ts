import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import type { ResearchProject } from './types'

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
  return data as ResearchProject[]
}

export async function getProject(id: string): Promise<ResearchProject | null> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('research_projects')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as ResearchProject | null
}

export async function createProject(
  input: ProjectInput,
): Promise<ResearchProject> {
  const { data, error } = await getSupabaseBrowserClient()
    .from('research_projects')
    .insert({
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
