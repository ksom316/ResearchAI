import { Link } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Eye } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import type { GapCandidateView } from '../view-model'

export function GapCandidateCard({
  view,
  onViewEvidence,
}: {
  view: GapCandidateView
  onViewEvidence: () => void
}) {
  const { candidate } = view
  return (
    <Card className="min-w-0 gap-4 overflow-hidden py-5">
      <CardHeader className="min-w-0 gap-2 px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="secondary">Potential {view.typeLabel.toLowerCase()}</Badge>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {candidate.isStale ? (
              <AlertTriangle className="size-3.5" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
            )}
            {candidate.isStale ? 'Includes stale evidence' : 'Current'}
          </span>
        </div>
        <CardTitle className="text-base break-words">{view.heading}</CardTitle>
        <p className="text-xs font-medium text-muted-foreground">
          {candidate.title}
        </p>
        <p className="text-sm break-words text-muted-foreground">
          {candidate.description}
        </p>
      </CardHeader>

      <CardContent className="min-w-0 space-y-4 px-5">
        <p className="text-sm font-medium">
          {candidate.supportCount} {candidate.supportCount === 1 ? 'paper' : 'papers'}{' '}
          <span aria-hidden="true">·</span>{' '}
          {candidate.evidenceCount} evidence{' '}
          {candidate.evidenceCount === 1 ? 'claim' : 'claims'}
        </p>

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">
            Supported by these papers
          </h4>
          <ul className="flex min-w-0 flex-wrap gap-2">
            {view.papers.map((paper) => (
              <li key={paper.paperId} className="min-w-0 max-w-full">
                <Button
                  asChild
                  variant="outline"
                  size="xs"
                  className="h-auto max-w-full whitespace-normal"
                >
                  <Link
                    to="/papers/$paperId"
                    params={{ paperId: paper.paperId }}
                    className="break-words"
                  >
                    {paper.title}
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">
            Related through
          </h4>
          <ul className="flex min-w-0 flex-wrap gap-2">
            {view.relatedTerms.map((term) => (
              <li key={term.termId}>
                <Badge variant="outline" className="whitespace-normal">
                  {term.label}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>

      <CardFooter className="px-5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onViewEvidence}
          aria-label={`View evidence for ${view.heading}`}
        >
          <Eye aria-hidden="true" /> View evidence
        </Button>
      </CardFooter>
    </Card>
  )
}
