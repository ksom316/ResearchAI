import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { resetPasswordSchema, signInSchema, signUpSchema } from './schemas'

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

/** Exchanges a PKCE auth code (Google OAuth or password recovery) for a session cookie. */
export const exchangeOAuthCodeFn = createServerFn({ method: 'POST' })
  .validator(z.object({ code: z.string().min(1).max(2048) }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const supabase = createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(data.code)
    return { ok: !error }
  })

/** Sets a new password for the user holding a (recovery) session. */
export const updatePasswordFn = createServerFn({ method: 'POST' })
  .validator(resetPasswordSchema)
  .handler(async ({ data }): Promise<AuthResult> => {
    const supabase = createSupabaseServerClient()
    const { data: current } = await supabase.auth.getUser()
    if (!current.user) {
      return {
        ok: false,
        message: 'Your reset link has expired. Request a new one to continue.',
      }
    }
    const { error } = await supabase.auth.updateUser({
      password: data.password,
    })
    if (!error) return { ok: true }
    const message =
      error.code === 'same_password'
        ? 'Choose a password different from your current one.'
        : error.code === 'weak_password'
          ? 'That password is too easy to guess. Try a longer or more varied one.'
          : 'We could not update your password. Please try again.'
    return { ok: false, message }
  })
