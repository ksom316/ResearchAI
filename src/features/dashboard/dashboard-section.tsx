import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'

export function DashboardSection({
  title,
  viewAllTo,
  children,
}: {
  title: string
  viewAllTo: '/projects' | '/library'
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg">{title}</CardTitle>
        <Link to={viewAllTo} className="text-sm font-medium">
          View all
        </Link>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
