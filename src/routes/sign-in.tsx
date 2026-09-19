import { createFileRoute, redirect } from '@tanstack/react-router'
import { getCurrentUser } from '#/lib/auth/auth.functions'
import { SignInForm } from '#/features/auth/sign-in-form'

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === 'string' ? { redirect: search.redirect } : {},
  beforeLoad: async () => {
    if (await getCurrentUser()) throw redirect({ to: '/dashboard' })
  },
  head: () => ({ meta: [{ title: 'Sign in · ResearchAI' }] }),
  component: SignInPage,
})

function SignInPage() {
  const { redirect: redirectTo } = Route.useSearch()
  return <SignInForm redirectTo={redirectTo} />
}
