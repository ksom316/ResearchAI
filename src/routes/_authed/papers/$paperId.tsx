import { createFileRoute } from '@tanstack/react-router'
import { PaperDetail } from '#/features/papers/detail/paper-detail'

export const Route = createFileRoute('/_authed/papers/$paperId')({
  head: () => ({ meta: [{ title: 'Paper · ResearchAI' }] }),
  component: PaperPage,
})

function PaperPage() {
  const { paperId } = Route.useParams()
  return <PaperDetail paperId={paperId} />
}
