import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import { useDeletePaper } from '../queries'
import type { Paper } from '../types'

export function DeletePaperDialog({
  paper,
  onOpenChange,
  onDeleted,
}: {
  paper: Paper | null
  onOpenChange: (open: boolean) => void
  /** Called right after the paper was deleted, before caches refresh (e.g. to leave its detail page). */
  onDeleted?: () => void | Promise<unknown>
}) {
  const remove = useDeletePaper(() => onOpenChange(false), { onDeleted })

  return (
    <AlertDialog
      open={paper !== null}
      onOpenChange={(open) => !remove.isPending && onOpenChange(open)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{paper?.title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the PDF and removes the paper from your
            library and every project. This can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => paper && remove.mutate(paper)}
          >
            {remove.isPending ? 'Deleting…' : 'Delete paper'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
