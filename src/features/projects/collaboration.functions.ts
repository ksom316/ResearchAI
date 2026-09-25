import { createServerFn } from '@tanstack/react-start'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'

export const acceptProjectInvitationFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data as { token: string })
  .handler(async ({ data }) => {
    const { data: projectId, error } = await createSupabaseServerClient().rpc('accept_project_invitation', { p_token: data.token })
    if (error) throw new Error('This invitation is no longer available, or it was sent to a different email address.')
    return projectId as string
  })
