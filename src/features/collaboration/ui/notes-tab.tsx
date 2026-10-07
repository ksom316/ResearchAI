import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileEdit, Plus } from 'lucide-react'
import { EmptyState } from '#/components/empty-state'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Skeleton } from '#/components/ui/skeleton'
import { Textarea } from '#/components/ui/textarea'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { formatDate } from '#/lib/format'
import { canEditNote } from '../permissions'
import { collaborationKeys, projectNotesQuery, useCreateNote, useUpdateNote } from '../queries'
import { subscribeToProjectCollaboration } from '../realtime'
import type { ProjectRole } from '#/features/projects/collaboration'
import type { Note } from '../types'

/**
 * Collaborative research notes. Concurrency model: optimistic locking via
 * `revision` (see migration 0024's update_note) - a save that targets a
 * revision someone else already advanced is rejected with NoteConflictError
 * rather than silently overwriting their edit. This is the architectural
 * seam for real-time co-editing (see the migration's comment on notes.revision);
 * this UI deliberately does NOT claim character-by-character simultaneous
 * editing, because that isn't what's implemented.
 */
export function NotesTab({ projectId, role }: { projectId: string; role: ProjectRole | null }) {
  const queryClient = useQueryClient()
  const notes = useQuery(projectNotesQuery(projectId))
  const createNote = useCreateNote(projectId)
  const [open, setOpen] = useState<Note | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')

  useEffect(() => {
    const unsubscribe = subscribeToProjectCollaboration(
      getSupabaseBrowserClient(),
      projectId,
      (table) => {
        if (table === 'notes') {
          void queryClient.invalidateQueries({ queryKey: collaborationKeys.notes(projectId) })
        }
      },
    )
    return unsubscribe
  }, [projectId, queryClient])

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Research notes</CardTitle>
        {canEditNote(role) && (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus /> New note
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {notes.isPending && <Skeleton className="h-20 rounded-md" />}
        {notes.data?.length === 0 && (
          <EmptyState
            icon={FileEdit}
            title="No notes yet"
            description="Capture findings, decisions, and open questions the team should share."
          />
        )}
        {notes.data?.map((note) => (
          <button
            key={note.id}
            type="button"
            className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-accent"
            onClick={() => setOpen(note)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{note.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                Updated {formatDate(note.updatedAt)}
                {note.lastEditedByName && ` by ${note.lastEditedByName}`}
              </span>
            </span>
          </button>
        ))}
      </CardContent>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New note</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="note-title">Title</Label>
            <Input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <Button
            disabled={title.trim() === '' || createNote.isPending}
            onClick={async () => {
              await createNote.mutateAsync({ title: title.trim() })
              setTitle('')
              setCreating(false)
            }}
          >
            Create note
          </Button>
        </DialogContent>
      </Dialog>

      {open && (
        <NoteEditorDialog
          note={open}
          projectId={projectId}
          canEdit={canEditNote(role)}
          onClose={() => setOpen(null)}
        />
      )}
    </Card>
  )
}

function NoteEditorDialog({
  note,
  projectId,
  canEdit,
  onClose,
}: {
  note: Note
  projectId: string
  canEdit: boolean
  onClose: () => void
}) {
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)
  const updateNote = useUpdateNote(projectId)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!canEdit}
              className="border-0 px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
            />
          </DialogTitle>
        </DialogHeader>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={!canEdit}
          rows={14}
          className="font-mono text-sm"
        />
        {canEdit && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              disabled={updateNote.isPending}
              onClick={async () => {
                await updateNote.mutateAsync({
                  noteId: note.id,
                  title: title.trim() || note.title,
                  content,
                  expectedRevision: note.revision,
                })
                onClose()
              }}
            >
              Save
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
