import { createFileRoute, redirect } from '@tanstack/react-router'
import { getCurrentUser } from '#/lib/auth/auth.functions'
import { LandingPage } from '#/features/landing/landing-page'
import { landingDestinationForUser } from '#/features/landing/routing'
import { AppLoadingScreen } from '#/components/app-loading-screen'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const destination = landingDestinationForUser(await getCurrentUser())
    if (destination) throw redirect({ to: destination })
  },
  pendingComponent: AppLoadingScreen,
  pendingMs: 0,
  pendingMinMs: 0,
  component: LandingPage,
})
