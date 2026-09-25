import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/page-header'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { UsagePanel } from '#/features/usage/ui/usage-panel'

export const Route = createFileRoute('/_authed/settings')({
  head: () => ({ meta: [{ title: 'Settings · ResearchAI' }] }),
  component: SettingsPage,
})

function SettingsPage() {
  const { user } = Route.useRouteContext()

  return (
    <>
      <PageHeader title="Settings" description="Manage your account." />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Your account details. Editing will arrive in a later phase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{user.fullName}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium break-all">{user.email}</dd>
          </dl>
        </CardContent>
      </Card>
      <UsagePanel />
    </>
  )
}
