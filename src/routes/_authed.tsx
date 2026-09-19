import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { getCurrentUser } from '#/lib/auth/auth.functions'
import { AppShell } from '#/components/layout/app-shell'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    return { user }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const { user } = Route.useRouteContext()
  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  )
}
