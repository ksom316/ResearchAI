import { Link } from '@tanstack/react-router'
import { AlertTriangle, CircleAlert, Info, ShieldCheck } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import type { WorkspaceTab } from '#/features/projects/workspace/tabs'
import type {
  InspectorFinding,
  InspectorSeverity,
} from '../types'

const severityPresentation = {
  significant: {
    label: 'Significant',
    icon: CircleAlert,
    badge: 'destructive' as const,
  },
  attention: {
    label: 'Attention',
    icon: AlertTriangle,
    badge: 'outline' as const,
  },
  info: { label: 'Info', icon: Info, badge: 'secondary' as const },
}

function FindingAction({
  finding,
  onNavigate,
}: {
  finding: InspectorFinding
  onNavigate: (tab: WorkspaceTab) => void
}) {
  const target = finding.actionTarget
  if (!target) return null
  if (target.type === 'paper') {
    return (
      <Button asChild variant="outline" size="sm">
        <Link to="/papers/$paperId" params={{ paperId: target.paperId }}>
          {finding.kind === 'citation_metadata_incomplete'
            ? 'Review citation metadata'
            : 'Review paper'}
        </Link>
      </Button>
    )
  }
  if (target.type === 'workspace') {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => onNavigate(target.tab === 'papers' ? 'papers' : 'evidence')}
      >
        {target.tab === 'papers' ? 'View papers' : 'Open Evidence Matrix'}
      </Button>
    )
  }
  return null
}

export function QualityInspectorView({
  findings,
  paperTitles,
  onNavigate,
}: {
  findings: readonly InspectorFinding[]
  paperTitles: ReadonlyMap<string, string>
  onNavigate: (tab: WorkspaceTab) => void
}) {
  if (findings.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No attention items identified"
        description="The deterministic checks did not identify a current workspace issue. This is not a score or proof of research quality."
      />
    )
  }

  const grouped = (['significant', 'attention', 'info'] as const)
    .map((severity) => ({
      severity,
      findings: findings.filter((finding) => finding.severity === severity),
    }))
    .filter((group) => group.findings.length > 0)

  return (
    <div className="min-w-0 space-y-8">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Research Quality Inspector</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Deterministic observations about workspace readiness, coverage, and
          metadata. These findings are not an overall quality score.
        </p>
      </header>

      {grouped.map(({ severity, findings: severityFindings }) => {
        const presentation = severityPresentation[severity]
        const Icon = presentation.icon
        return (
          <section key={severity} aria-labelledby={`quality-${severity}`}>
            <div className="mb-3 flex items-center gap-2">
              <Icon className="size-4" aria-hidden="true" />
              <h3 id={`quality-${severity}`} className="font-semibold">
                {presentation.label}
              </h3>
              <Badge variant={presentation.badge}>{severityFindings.length}</Badge>
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
              {severityFindings.map((finding) => {
                const affectedPapers = finding.relatedPaperIds
                  .map((paperId) => paperTitles.get(paperId))
                  .filter((title): title is string => Boolean(title))
                return (
                  <Card key={finding.id} className="min-w-0 gap-4 py-5">
                    <CardHeader className="min-w-0 px-5">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant={presentation.badge}>
                          {presentation.label}
                        </Badge>
                        <CardTitle className="min-w-0 break-words text-base leading-snug">
                          {finding.title}
                        </CardTitle>
                      </div>
                      <CardDescription className="break-words leading-relaxed">
                        {finding.message}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 px-5">
                      {affectedPapers.length > 0 && (
                        <p className="break-words text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            Affected paper{affectedPapers.length === 1 ? '' : 's'}:
                          </span>{' '}
                          {affectedPapers.join(', ')}
                        </p>
                      )}
                      <FindingAction finding={finding} onNavigate={onNavigate} />
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function severityLabel(severity: InspectorSeverity): string {
  return severityPresentation[severity].label
}
