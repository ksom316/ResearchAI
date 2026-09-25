import { queryOptions } from '@tanstack/react-query'
import { getUsageSummaryFn } from './usage.functions'

export const usageKeys = {
  summary: (month: string) => ['usage', 'summary', month] as const,
}

export const usageSummaryQuery = (month: string) =>
  queryOptions({
    queryKey: usageKeys.summary(month),
    queryFn: () => getUsageSummaryFn({ data: { month } }),
  })
