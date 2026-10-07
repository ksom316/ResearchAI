import { createFileRoute, useRouteContext } from '@tanstack/react-router'
import { PaperDetail } from '#/features/papers/detail/paper-detail'

export const Route = createFileRoute('/_authed/papers/$paperId')({
  head: () => ({ meta: [{ title: 'Paper · Evidara' }] }),
  component: PaperPage,
})

function PaperPage() {
  const { paperId } = Route.useParams()
  const { user } = useRouteContext({ from: '/_authed' })
  return <PaperDetail paperId={paperId} currentUserId={user.id} />
}
