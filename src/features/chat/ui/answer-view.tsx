import type { ReactNode } from 'react'
import { AlertCircle, FileText, Info } from 'lucide-react'
import { cn } from 'cn'
import { formatPages, humanize } from '#/lib/format'
import { allowanceReachedMessage } from '#/lib/usage/presentation'
import type { AskOutcome, ChatCitation } from '../types'
import {
  ERROR_MESSAGES,
  FALLBACK_ERROR_MESSAGE,
  NO_EVIDENCE_MESSAGE,
} from './messages'

// Shared with the Evidence Matrix; re-exported so existing importers keep working.
export { formatPages }

/** A clickable citation chip. Shows only the evidence id, e.g. [S1]. */
export function CitationChip({
  citation,
  selected,
  onSelect,
}: {
  citation: ChatCitation
  selected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Source ${citation.id}: ${citation.paperTitle}`}
      onClick={() => onSelect(citation.id)}
      className={cn(
        'mx-0.5 inline-flex h-6 min-w-8 items-center justify-center rounded-md border px-1.5 align-baseline text-xs font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'bg-accent text-accent-foreground hover:bg-accent/70',
      )}
    >
      [{citation.id}]
    </button>
  )
}

/** Server-built metadata for one source. No chunk id, scores or internal fields. */
export function SourcePanel({
  citation,
  viewPaper,
}: {
  citation: ChatCitation
  /** Rendered "View paper" action (a router link supplied by the caller). */
  viewPaper: ReactNode
}) {
  const pages = formatPages(citation.pageStart, citation.pageEnd)
  return (
    <div
      role="region"
      aria-label={`Source ${citation.id}`}
      className="min-w-0 rounded-lg border bg-card p-3 text-sm"
    >
      <p className="flex items-start gap-2 font-medium break-words">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">{citation.paperTitle}</span>
      </p>
      <dl className="mt-2 space-y-1 text-muted-foreground">
        <div className="flex flex-wrap gap-x-2">
          <dt>Section:</dt>
          <dd className="min-w-0 break-words text-foreground">
            {citation.sectionTitle}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt>Type:</dt>
          <dd className="text-foreground capitalize">
            {humanize(citation.sectionType)}
          </dd>
        </div>
        {pages && (
          <div className="flex flex-wrap gap-x-2">
            <dt>Pages:</dt>
            <dd className="text-foreground">{pages}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3">{viewPaper}</div>
    </div>
  )
}

function Note({
  tone,
  children,
}: {
  tone: 'info' | 'error'
  children: ReactNode
}) {
  const Icon = tone === 'error' ? AlertCircle : Info
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'flex items-start gap-2 text-sm break-words',
        tone === 'error' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/**
 * Renders one server outcome. All model text is ordinary React text (never HTML) and
 * citation ids come only from the server-validated `segment.citations`.
 */
export function AnswerView({
  outcome,
  selectedId,
  onSelectCitation,
  viewPaper,
}: {
  outcome: AskOutcome
  selectedId: string | null
  onSelectCitation: (id: string) => void
  viewPaper: (paperId: string) => ReactNode
}) {
  if (!outcome.ok) {
    const message =
      outcome.error === 'usage_exhausted' && outcome.resetDate
        ? allowanceReachedMessage(outcome.resetDate)
        : ((ERROR_MESSAGES as Partial<Record<string, string>>)[outcome.error] ??
          FALLBACK_ERROR_MESSAGE)
    return <Note tone="error">{message}</Note>
  }

  if (outcome.status === 'no_evidence') {
    return <Note tone="info">{NO_EVIDENCE_MESSAGE}</Note>
  }

  if (outcome.status !== 'answered') {
    return outcome.explanation ? (
      <Note tone="info">{outcome.explanation}</Note>
    ) : (
      <Note tone="info">
        {outcome.status === 'out_of_scope'
          ? 'This question does not appear to relate to the papers in this project.'
          : 'The papers in this project do not contain enough evidence to answer this.'}
      </Note>
    )
  }

  const byId = new Map(outcome.citations.map((c) => [c.id, c]))
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null

  return (
    <div className="min-w-0 space-y-3">
      {outcome.segments.map((segment, index) => (
        <p key={index} className="text-sm leading-relaxed break-words">
          {segment.text}
          {segment.citations.map((id) => {
            const citation = byId.get(id)
            return citation ? (
              <CitationChip
                key={id}
                citation={citation}
                selected={selectedId === id}
                onSelect={onSelectCitation}
              />
            ) : null
          })}
        </p>
      ))}
      {outcome.limitations && (
        <Note tone="info">Limitations: {outcome.limitations}</Note>
      )}
      {selected && (
        <SourcePanel
          citation={selected}
          viewPaper={viewPaper(selected.paperId)}
        />
      )}
    </div>
  )
}
