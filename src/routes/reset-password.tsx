import { createFileRoute, redirect } from '@tanstack/react-router'
import { exchangeOAuthCodeFn, getCurrentUser } from '#/lib/auth/auth.functions'
import { ResetPasswordForm } from '#/features/auth/reset-password-form'

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

const invalidLink = () =>
  redirect({ to: '/forgot-password', search: { error: 'link_invalid' } })

// Supabase's default recovery email returns here with ?code=... (PKCE). The
// code is exchanged for a session, then the URL is cleaned via a redirect.
export const Route = createFileRoute('/reset-password')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { code?: string; error?: string } => ({
    code: str(search.code),
    error: str(search.error),
  }),
  beforeLoad: async ({ search }) => {
    if (search.error) throw invalidLink()
    if (search.code) {
      const { ok } = await exchangeOAuthCodeFn({ data: { code: search.code } })
      if (!ok) throw invalidLink()
      throw redirect({ to: '/reset-password' })
    }
    if (!(await getCurrentUser())) throw invalidLink()
  },
  head: () => ({ meta: [{ title: 'Reset password · ResearchAI' }] }),
  component: ResetPasswordForm,
})
