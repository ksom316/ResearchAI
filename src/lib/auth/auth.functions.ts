import { createServerFn } from '@tanstack/react-start'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { signInSchema, signUpSchema } from './schemas'

export type AuthUser = {
  id: string
  email: string
  fullName: string
}

export type AuthResult =
  | { ok: true; needsEmailConfirmation?: boolean }
  | { ok: false; message: string }

/** Returns the verified current user (validated with Supabase Auth), or null. */
export const getCurrentUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuthUser | null> => {
    const supabase = createSupabaseServerClient()
    const { data } = await supabase.auth.getUser()
    const user = data.user
    if (!user) return null

    const email = user.email ?? ''
    const fullName =
      typeof user.user_metadata.full_name === 'string' &&
      user.user_metadata.full_name
        ? user.user_metadata.full_name
        : email.split('@')[0]

    return { id: user.id, email, fullName }
  },
)

export const signInFn = createServerFn({ method: 'POST' })
  .validator(signInSchema)
  .handler(async ({ data }): Promise<AuthResult> => {
    const supabase = createSupabaseServerClient()
    const { error } = await supabase.auth.signInWithPassword(data)
    if (error) return { ok: false, message: error.message }
    return { ok: true }
  })

export const signUpFn = createServerFn({ method: 'POST' })
  .validator(signUpSchema)
  .handler(async ({ data }): Promise<AuthResult> => {
    const supabase = createSupabaseServerClient()
    const { data: result, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: { data: { full_name: data.fullName } },
    })
    if (error) return { ok: false, message: error.message }
    return { ok: true, needsEmailConfirmation: !result.session }
  })

export const signOutFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<void> => {
    const supabase = createSupabaseServerClient()
    await supabase.auth.signOut()
  },
)
