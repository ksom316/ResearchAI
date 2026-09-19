import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ListTree } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { QueryError } from '#/components/query-error'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { buildOutline } from '../outline'
import { paperSectionsQuery } from '../queries'

/** Sections shown before the outline collapses behind a "show all" toggle. */
const COLLAPSED_COUNT = 12

/**
 * Document outline for a ready paper: section titles, semantic type and pages,
 * in reading order. Section text and chunks are never loaded here.
 */
export function PaperOutline({ paperId }: { paperId: string }) {
  const { data, error, isPending, refetch } = useQuery(
    paperSectionsQuery(paperId),
  )
  const [expanded, setExpanded] = useState(false)

  if (error) return <QueryError error={error} onRetry={() => refetch()} />

  if (isPending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 rounded-lg" />
        ))}
      </div>
    )
  }

  const outline = buildOutline(data)
  if (outline.length === 0) {
    return (
      <EmptyState
        icon={ListTree}
        title="No sections detected"
        description="The text was extracted, but no section structure could be identified."
      />
    )
  }

  const collapsible = outline.length > COLLAPSED_COUNT
  const visible =
    collapsible && !expanded ? outline.slice(0, COLLAPSED_COUNT) : outline

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Document outline</CardTitle>
        <p className="text-sm text-muted-foreground">
          {outline.length} {outline.length === 1 ? 'section' : 'sections'}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="divide-y">
          {visible.map((item) => (
            <li key={item.id} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium break-words">{item.title}</p>
                {item.typeLabel && (
                  <Badge variant="outline" className="mt-1">
                    {item.typeLabel}
                  </Badge>
                )}
              </div>
              {item.pages && (
                <span className="shrink-0 pt-0.5 text-xs whitespace-nowrap text-muted-foreground">
                  {item.pages}
                </span>
              )}
            </li>
          ))}
        </ol>
        {collapsible && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Show fewer' : `Show all ${outline.length} sections`}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
