import { useState } from 'react'
import type { FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { DialogFooter } from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import type { ProjectInput } from '../api'

export function ProjectForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
}: {
  initial?: ProjectInput
  submitLabel: string
  pending: boolean
  onSubmit: (input: ProjectInput) => void
}) {
  const [error, setError] = useState<string>()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const title = String(form.get('title') ?? '').trim()
    const description = String(form.get('description') ?? '').trim()

    if (!title) return setError('Give your project a title.')
    if (title.length > 200)
      return setError('Title must be 200 characters or fewer.')
    if (description.length > 2000)
      return setError('Description must be 2000 characters or fewer.')

    setError(undefined)
    onSubmit({ title, description })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          defaultValue={initial?.title}
          placeholder="e.g. Transformer models for protein folding"
          autoFocus
          maxLength={200}
          aria-invalid={!!error}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={initial?.description ?? ''}
          placeholder="What question are you investigating?"
          rows={3}
          maxLength={2000}
        />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
