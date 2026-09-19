import { useQuery } from '@tanstack/react-query'
import { FileText } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { QueryError } from '#/components/query-error'
import { Skeleton } from '#/components/ui/skeleton'
import { papersQuery } from '../queries'
import { PaperRow } from './paper-row'

export function PaperList({
  projectId,
  limit,
  emptyDescription = 'Papers you add will appear here.',
}: {
  projectId?: string
  limit?: number
  emptyDescription?: string
}) {
  const { data, error, isPending, refetch } = useQuery(
    papersQuery({ projectId, limit }),
  )

  if (error) return <QueryError error={error} onRetry={() => refetch()} />

  if (isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No papers yet"
        description={emptyDescription}
      />
    )
  }

  return (
    <ul className="divide-y">
      {data.map((paper) => (
        <PaperRow key={paper.id} paper={paper} />
      ))}
    </ul>
  )
}
