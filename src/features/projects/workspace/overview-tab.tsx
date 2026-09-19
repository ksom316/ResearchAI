import { useQuery } from '@tanstack/react-query'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { formatDate } from '#/lib/format'
import { papersQuery } from '#/features/papers/queries'
import type { ResearchProject } from '../types'

export function OverviewTab({ project }: { project: ResearchProject }) {
  const papers = useQuery(papersQuery({ projectId: project.id }))

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Research question</CardTitle>
          <CardDescription>What this project is about.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm break-words whitespace-pre-wrap">
            {project.description ||
              'No description yet. Use “Edit” to add one.'}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>At a glance</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <Row label="Papers" value={papers.data?.length.toString() ?? '—'} />
            <Row label="Created" value={formatDate(project.created_at)} />
            <Row label="Last updated" value={formatDate(project.updated_at)} />
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
