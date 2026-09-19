import { createFileRoute, redirect } from '@tanstack/react-router'
import { exchangeOAuthCodeFn } from '#/lib/auth/auth.functions'
import { safeRedirect } from '#/lib/auth/redirect'

type CallbackSearch = { code?: string; error?: string; next?: string }

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

/** OAuth return URL. Exchanges the code, then redirects; renders nothing. */
export const Route = createFileRoute('/auth/callback')({
  validateSearch: (search: Record<string, unknown>): CallbackSearch => ({
    code: str(search.code),
    error: str(search.error),
    next: str(search.next),
  }),
  beforeLoad: async ({ search }) => {
    if (search.error) {
      throw redirect({
        to: '/sign-in',
        search: {
          error:
            search.error === 'access_denied'
              ? 'oauth_cancelled'
              : 'oauth_failed',
        },
      })
    }
    if (!search.code) {
      throw redirect({ to: '/sign-in', search: { error: 'oauth_failed' } })
    }
    const result = await exchangeOAuthCodeFn({ data: { code: search.code } })
    if (!result.ok) {
      throw redirect({ to: '/sign-in', search: { error: 'oauth_failed' } })
    }
    throw redirect({ href: safeRedirect(search.next) })
  },
  head: () => ({ meta: [{ title: 'Signing in · ResearchAI' }] }),
})
