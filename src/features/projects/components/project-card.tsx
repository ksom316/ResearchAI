import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { FlaskConical, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { formatDate } from '#/lib/format'
import { DeleteProjectDialog } from './delete-project-dialog'
import { RenameProjectDialog } from './rename-project-dialog'
import type { ResearchProject } from '../types'

export function ProjectCard({ project }: { project: ResearchProject }) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <Card className="group relative transition-shadow hover:shadow-md">
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <FlaskConical className="size-5" />
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative z-10 -mt-1 -mr-2"
                aria-label={`Actions for ${project.title}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="truncate text-base font-semibold">
            <Link
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className="text-foreground no-underline before:absolute before:inset-0 before:content-['']"
            >
              {project.title}
            </Link>
          </h3>
          <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
            {project.description || 'No description yet.'}
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          Updated {formatDate(project.updated_at)}
        </p>
      </CardContent>

      <RenameProjectDialog
        project={project}
        open={renameOpen}
        onOpenChange={setRenameOpen}
      />
      <DeleteProjectDialog
        project={project}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </Card>
  )
}
