import { createFileRoute, redirect } from '@tanstack/react-router'

// The dashboard route enforces authentication and redirects to /sign-in.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' })
  },
})
