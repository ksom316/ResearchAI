import { createFileRoute } from '@tanstack/react-router'
import { ForgotPasswordForm } from '#/features/auth/forgot-password-form'

export const Route = createFileRoute('/forgot-password')({
  validateSearch: (search: Record<string, unknown>): { error?: string } =>
    typeof search.error === 'string' ? { error: search.error } : {},
  head: () => ({ meta: [{ title: 'Forgot password · ResearchAI' }] }),
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const { error } = Route.useSearch()
  return <ForgotPasswordForm linkInvalid={error === 'link_invalid'} />
}
