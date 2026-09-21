import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { getCurrentUser } from '#/lib/auth/auth.functions'
import { AppShell } from '#/components/layout/app-shell'
import { AppLoadingScreen } from '#/components/app-loading-screen'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    return { user }
  },
  pendingComponent: AppLoadingScreen,
  pendingMs: 0,
  pendingMinMs: 0,
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
