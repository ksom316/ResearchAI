import { useQuery } from '@tanstack/react-query'
import { Blocks, Bot, FileCheck2, MessageSquareText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { QueryError } from '#/components/query-error'
import type { UsageSummary } from '#/lib/usage/types'
import { usageSummaryQuery } from '../queries'
import { currentUsageMonth } from '../usage.functions'
import {
  allowanceProgressLabel,
  allowanceState,
  formatAllowanceResetDate,
  formatAllowanceValue,
} from './allowance-presentation'
import {
  formatStorage,
  StorageProgressRing,
  storageState,
} from './storage-capacity'

const labels: Record<string, string> = {
  research_chat: 'Research Chat',
  academic_writer: 'Academic Writer',
  claim_checker: 'Claim Checker',
  evidence_matrix: 'Evidence Matrix',
  research_gaps: 'Research Gaps',
  semantic_search: 'Semantic Search',
  paper_processing: 'Paper Processing',
  embedding_indexing: 'Embedding Indexing',
}

const number = new Intl.NumberFormat()
function monthLabel(month: string): string {
  const [year, value] = month.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, value - 1, 1)))
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardContent className="flex items-center gap-4 px-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function AllowanceMetricCard({
  icon: Icon,
  label,
  used,
  limit,
  percent,
  resetDate,
  compactValues = false,
}: {
  icon: LucideIcon
  label: string
  used: number
  limit: number
  percent: number
  resetDate: string
  compactValues?: boolean
}) {
  const state = allowanceState(percent)
  const format = (value: number) => formatAllowanceValue(value, compactValues)
  const reset = formatAllowanceResetDate(resetDate)

  return (
    <Card className="gap-4 py-5 shadow-xs">
      <CardContent className="space-y-4 px-5">
        <div className="flex items-center gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-lg font-semibold tracking-tight tabular-nums">
              {format(used)} of {format(limit)} used
            </p>
          </div>
        </div>
        <div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={allowanceProgressLabel({
              label,
              used,
              limit,
              resetDate,
              compactValue: compactValues,
            })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, percent)}
          >
            <div
              className={`h-full rounded-full ${state.barClass}`}
              style={{ width: `${Math.min(100, percent)}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs">
            <span className={state.textClass}>
              {state.label ?? `${percent}% used`}
            </span>
            <span className="text-muted-foreground">Resets {reset}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function UsageSummaryView({ usage }: { usage: UsageSummary }) {
  const storage = storageState(usage.storagePercent)

  return (
    <section className="max-w-5xl space-y-5" aria-labelledby="usage-heading">
      <div>
        <h2 id="usage-heading" className="text-xl font-semibold tracking-tight">
          Usage
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {monthLabel(usage.month)}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AllowanceMetricCard
          icon={MessageSquareText}
          label="AI requests"
          used={usage.aiRequests}
          limit={usage.aiRequestLimit}
          percent={usage.aiRequestPercent}
          resetDate={usage.allowancePeriodEnd}
        />
        <AllowanceMetricCard
          icon={Bot}
          label="AI tokens"
          used={usage.aiTokensUsed}
          limit={usage.aiTokenLimit}
          percent={usage.aiTokenPercent}
          resetDate={usage.allowancePeriodEnd}
          compactValues
        />
        <MetricCard
          icon={FileCheck2}
          label="Papers processed"
          value={number.format(usage.papersProcessed)}
        />
        <MetricCard
          icon={Blocks}
          label="Embedding chunks"
          value={number.format(usage.embeddingChunks)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Storage</CardTitle>
          <CardDescription>
            Your current research library capacity.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:gap-10">
          <StorageProgressRing storage={usage} />
          <div className="w-full min-w-0 text-center sm:text-left">
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatStorage(usage.storageBytes)} used
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              of {formatStorage(usage.storageCapacityBytes)}
            </p>
            <p className="mt-4 text-sm font-medium tabular-nums">
              {formatStorage(usage.storageRemainingBytes)} available
            </p>
            {storage.label && (
              <p className={`mt-2 text-sm font-medium ${storage.messageClass}`}>
                {storage.label}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {usage.featureBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>AI usage by feature</CardTitle>
            <CardDescription>
              Requests made across ResearchAI tools.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y rounded-lg border">
              {usage.featureBreakdown.map((item) => (
                <div
                  key={item.feature}
                  className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                >
                  <dt>{labels[item.feature] ?? item.feature}</dt>
                  <dd className="shrink-0 font-medium tabular-nums">
                    {number.format(item.requests)}{' '}
                    {item.requests === 1 ? 'request' : 'requests'}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
    </section>
  )
}

export function UsagePanel() {
  const month = currentUsageMonth()
  const query = useQuery(usageSummaryQuery(month))

  if (query.isPending) {
    return (
      <div className="max-w-5xl space-y-4" aria-label="Loading usage">
        <Skeleton className="h-12 w-44" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }
  if (query.error) {
    return (
      <QueryError error={query.error} onRetry={() => void query.refetch()} />
    )
  }
  return <UsageSummaryView usage={query.data} />
}
