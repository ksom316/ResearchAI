import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { getCurrentUser } from '#/lib/auth/auth.functions'
import { acceptProjectInvitationFn } from '#/features/projects/collaboration.functions'

export const Route = createFileRoute('/invite')({
  validateSearch: (search: Record<string, unknown>) => ({ token: typeof search.token === 'string' ? search.token : '' }),
  beforeLoad: async ({ location }) => {
    if (!(await getCurrentUser())) throw redirect({ to: '/sign-in', search: { redirect: location.href } })
  },
  component: InvitePage,
})

function InvitePage() {
  const { token } = Route.useSearch()
  const navigate = useNavigate()
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  async function accept() {
    setState('working')
    try { await acceptProjectInvitationFn({ data: { token } }); setState('done'); setMessage('You now have access to the shared project.') }
    catch (e) { setState('error'); setMessage(e instanceof Error ? e.message : 'This invitation could not be accepted.') }
  }
  return <main className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center">
    <Card className="w-full"><CardHeader><CardTitle>Project invitation</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Accept this invitation to add the shared project to your ResearchAI workspace.</p>
      {message && <p className={state === 'error' ? 'text-sm text-destructive' : 'text-sm'}>{message}</p>}
      {state === 'done' ? <Button onClick={() => void navigate({ to: '/projects' })}>Open projects</Button> : <Button disabled={!token || state === 'working'} onClick={() => void accept()}>{state === 'working' ? 'Accepting…' : 'Accept invitation'}</Button>}
    </CardContent></Card>
  </main>
}
