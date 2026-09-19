import { Plus } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { CreateProjectDialog } from './create-project-dialog'

export function CreateProjectButton({
  variant = 'default',
  label = 'New project',
}: {
  variant?: 'default' | 'outline'
  label?: string
}) {
  return (
    <CreateProjectDialog>
      <Button variant={variant}>
        <Plus /> {label}
      </Button>
    </CreateProjectDialog>
  )
}
