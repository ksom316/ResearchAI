import { createFileRoute, redirect } from '@tanstack/react-router'
import { getCurrentUser } from '#/lib/auth/auth.functions'
import { SignUpForm } from '#/features/auth/sign-up-form'

export const Route = createFileRoute('/sign-up')({
  beforeLoad: async () => {
    if (await getCurrentUser()) throw redirect({ to: '/dashboard' })
  },
  head: () => ({ meta: [{ title: 'Create account · ResearchAI' }] }),
  component: SignUpForm,
})
