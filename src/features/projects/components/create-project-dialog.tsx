import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { useCreateProject } from '../queries'
import { ProjectForm } from './project-form'

export function CreateProjectDialog({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const create = useCreateProject((projectId) => {
    setOpen(false)
    void navigate({ to: '/projects/$projectId', params: { projectId } })
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New research project</DialogTitle>
          <DialogDescription>
            A project groups the papers, evidence, and writing for one line of
            inquiry.
          </DialogDescription>
        </DialogHeader>
        <ProjectForm
          submitLabel="Create project"
          pending={create.isPending}
          onSubmit={(input) => create.mutate(input)}
        />
      </DialogContent>
    </Dialog>
  )
}
