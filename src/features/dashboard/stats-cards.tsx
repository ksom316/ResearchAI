import { useQuery } from '@tanstack/react-query'
import { Bot, Clock, FlaskConical, HardDrive, Library } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { libraryStatsQuery } from '#/features/papers/queries'
import { projectsQuery } from '#/features/projects/queries'
import { usageSummaryQuery } from '#/features/usage/queries'
import { currentUsageMonth } from '#/features/usage/usage.functions'
import {
  allowanceProgressLabel,
  allowanceState,
  formatAllowanceResetDate,
  formatAllowanceValue,
} from '#/features/usage/ui/allowance-presentation'
import {
  formatStorage,
  StorageProgressRing,
  storageState,
} from '#/features/usage/ui/storage-capacity'
import type { StorageCapacity } from '#/features/usage/ui/storage-capacity'
import type { UsageSummary } from '#/lib/usage/types'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string | undefined
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          {value === undefined ? (
            <Skeleton className="mt-1 h-7 w-16" />
          ) : (
            <p className="text-2xl font-semibold">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function DashboardStorageCard({
  storage,
  isLoading = false,
}: {
  storage?: StorageCapacity
  isLoading?: boolean
}) {
  const state = storageState(storage?.storagePercent ?? null)

  return (
    <Card>
      <CardContent className="flex min-h-44 items-center gap-4 sm:gap-6">
        {isLoading ? (
          <Skeleton className="size-20 shrink-0 rounded-full" />
        ) : storage ? (
          <StorageProgressRing storage={storage} size="compact" />
        ) : (
          <span className="flex size-20 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <HardDrive className="size-5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Storage used</p>
          {isLoading ? (
            <Skeleton className="mt-2 h-6 w-28" />
          ) : storage ? (
            <>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {formatStorage(storage.storageBytes)} /{' '}
                {formatStorage(storage.storageCapacityBytes)}
              </p>
              {state.label && (
                <p className={`mt-1 text-xs font-medium ${state.messageClass}`}>
                  {state.label}
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Unavailable</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

type AiAllowanceSummary = Pick<
  UsageSummary,
  | 'aiRequests'
  | 'aiRequestLimit'
  | 'aiRequestPercent'
  | 'aiTokensUsed'
  | 'aiTokenLimit'
  | 'aiTokenPercent'
  | 'aiAllowancePercent'
  | 'allowancePeriodEnd'
>

function AllowanceBar({
  label,
  used,
  limit,
  percent,
  resetDate,
  compactValue = false,
}: {
  label: string
  used: number
  limit: number
  percent: number
  resetDate: string
  compactValue?: boolean
}) {
  const state = allowanceState(percent)
  const progress = Math.min(100, Math.max(0, percent))

  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="whitespace-nowrap font-medium tabular-nums">
          {formatAllowanceValue(used, compactValue)} /{' '}
          {formatAllowanceValue(limit, compactValue)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={allowanceProgressLabel({
          label: `AI ${label.toLowerCase()}`,
          used,
          limit,
          resetDate,
          compactValue,
        })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className={`h-full rounded-full ${state.barClass}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

export function DashboardAiAllowanceCard({
  usage,
  isLoading = false,
}: {
  usage?: AiAllowanceSummary
  isLoading?: boolean
}) {
  const state = allowanceState(usage?.aiAllowancePercent ?? 0)

  return (
    <Card>
      <CardContent className="flex min-h-44 gap-4 sm:gap-6">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-medium">AI usage</p>
            {usage && (
              <p className="whitespace-nowrap text-xs text-muted-foreground">
                Resets {formatAllowanceResetDate(usage.allowancePeriodEnd)}
              </p>
            )}
          </div>
          {isLoading ? (
            <div className="mt-4 space-y-4" aria-label="Loading AI usage">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : usage ? (
            <div className="mt-4 space-y-3">
              <AllowanceBar
                label="Requests"
                used={usage.aiRequests}
                limit={usage.aiRequestLimit}
                percent={usage.aiRequestPercent}
                resetDate={usage.allowancePeriodEnd}
              />
              <AllowanceBar
                label="Tokens"
                used={usage.aiTokensUsed}
                limit={usage.aiTokenLimit}
                percent={usage.aiTokenPercent}
                resetDate={usage.allowancePeriodEnd}
                compactValue
              />
              {state.label && (
                <p className={`text-xs font-medium ${state.textClass}`}>
                  {state.label}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              AI usage is temporarily unavailable.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function DashboardResourceCards({
  usage,
  isLoading = false,
}: {
  usage?: UsageSummary
  isLoading?: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <DashboardAiAllowanceCard usage={usage} isLoading={isLoading} />
      <DashboardStorageCard storage={usage} isLoading={isLoading} />
    </div>
  )
}

export function StatsCards() {
  const projects = useQuery(projectsQuery())
  const library = useQuery(libraryStatsQuery)
  const usage = useQuery(usageSummaryQuery(currentUsageMonth()))

  const activeThisWeek = projects.data?.filter(
    (p) => Date.now() - new Date(p.updated_at).getTime() < WEEK_MS,
  ).length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={FlaskConical}
          label="Research projects"
          value={projects.data?.length.toString()}
        />
        <StatCard
          icon={Library}
          label="Papers in library"
          value={library.data?.paperCount.toString()}
        />
        <StatCard
          icon={Clock}
          label="Active this week"
          value={activeThisWeek?.toString()}
        />
      </div>
      <DashboardResourceCards usage={usage.data} isLoading={usage.isPending} />
    </div>
  )
}
