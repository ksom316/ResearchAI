import { Link } from '@tanstack/react-router'
import { AlertTriangle, ChevronDown, CircleAlert, Info } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { inspectDraft } from '../inspect'
import type { AssessmentByUnitId } from '../assessment-state'
import type { GroundedDraft } from '#/features/writer/types'
import type { InspectorFinding } from '../types'

const presentation = {
  significant: {
    label: 'Significant',
    icon: CircleAlert,
    variant: 'destructive' as const,
  },
  attention: {
    label: 'Attention',
    icon: AlertTriangle,
    variant: 'outline' as const,
  },
  info: { label: 'Info', icon: Info, variant: 'secondary' as const },
}

export function focusDraftUnit(unitId: string): void {
  const target = document.getElementById(`writer-unit-${unitId}`)
  target?.focus({ preventScroll: true })
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function FindingContext({
  finding,
  draft,
}: {
  finding: InspectorFinding
  draft: GroundedDraft
}) {
  const unitId = finding.relatedUnitIds[0]
  if (unitId) {
    const unit = draft.paragraphs
      .flatMap((paragraph) => paragraph.units)
      .find((candidate) => candidate.id === unitId)
    if (!unit) return null
    return (
      <div className="min-w-0 space-y-2">
        <blockquote className="border-l-2 pl-3 text-sm break-words text-muted-foreground">
          {unit.text}
        </blockquote>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Go to draft statement: ${unit.text}`}
          onClick={() => focusDraftUnit(unit.id)}
        >
          Go to statement
        </Button>
      </div>
    )
  }

  const paperId = finding.relatedPaperIds[0]
  if (!paperId) return null
  const reference = draft.references.find((item) => item.paperId === paperId)
  return (
    <div className="min-w-0 space-y-2">
      {reference && (
        <p className="text-sm break-words text-muted-foreground">
          {reference.metadata.title}
        </p>
      )}
      <Button asChild size="sm" variant="outline">
        <Link to="/papers/$paperId" params={{ paperId }}>
          Review paper
        </Link>
      </Button>
    </div>
  )
}

export function DraftInspectionPanel({
  draft,
  assessmentsByUnitId,
}: {
  draft: GroundedDraft
  assessmentsByUnitId: AssessmentByUnitId
}) {
  const findings = inspectDraft({ draft, assessmentsByUnitId })

  return (
    <details className="group min-w-0 rounded-xl border bg-card">
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-4 py-3 font-semibold focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:px-5">
        <ChevronDown
          className="size-4 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
        <span className="min-w-0 break-words">Draft inspection</span>
        <Badge variant="secondary" className="ml-auto">
          {findings.length} finding{findings.length === 1 ? '' : 's'}
        </Badge>
      </summary>
      <div className="min-w-0 space-y-3 border-t p-4 sm:p-5">
        <p className="text-sm text-muted-foreground">
          Deterministic observations about this draft. This is not an overall
          score or grade.
        </p>
        {findings.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No draft attention items are currently identified. This does not
            prove the draft is complete or universally correct.
          </p>
        ) : (
          <ul className="min-w-0 space-y-3">
            {findings.map((finding) => {
              const status = presentation[finding.severity]
              const Icon = status.icon
              return (
                <li
                  key={finding.id}
                  className="min-w-0 space-y-3 rounded-lg border p-4"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <h3 className="min-w-0 break-words text-sm font-semibold">
                      {finding.title}
                    </h3>
                  </div>
                  <p className="text-sm break-words text-muted-foreground">
                    {finding.message}
                  </p>
                  <FindingContext finding={finding} draft={draft} />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </details>
  )
}
