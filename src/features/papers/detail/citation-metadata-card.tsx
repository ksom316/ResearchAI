import { useState } from 'react'
import { BookOpen, Loader2, Pencil } from 'lucide-react'
import { assessCitationMetadataCompleteness } from '#/features/citations/normalize'
import { formatNumericReference } from '#/features/citations/format'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { paperRowToCitationMetadata } from '../citation-metadata'
import type {
  CitationMetadataUpdateField,
  CitationMetadataUpdateRequest,
} from '../citation-metadata-service'
import { useUpdateCitationMetadata } from '../queries'
import type { Paper } from '../types'

type FormState = {
  citationTitle: string
  authors: string
  publicationYear: string
  containerTitle: string
  publisher: string
  doi: string
  url: string
  volume: string
  issue: string
  pages: string
}

const IMPORTANT_FIELD_LABELS = {
  title: 'citation title',
  authors: 'authors',
  publicationYear: 'publication year',
} as const

const emptyToNull = (value: string) => value.trim() || null

function formFromPaper(paper: Paper): FormState {
  return {
    citationTitle: paper.citation_title ?? '',
    authors: paper.authors.join('\n'),
    publicationYear: paper.publication_year?.toString() ?? '',
    containerTitle: paper.citation_container_title ?? '',
    publisher: paper.citation_publisher ?? '',
    doi: paper.citation_doi ?? '',
    url: paper.citation_url ?? '',
    volume: paper.citation_volume ?? '',
    issue: paper.citation_issue ?? '',
    pages: paper.citation_pages ?? '',
  }
}

function requestFromForm(
  paperId: string,
  form: FormState,
): CitationMetadataUpdateRequest {
  return {
    paperId,
    citationTitle: emptyToNull(form.citationTitle),
    authors: form.authors
      .split('\n')
      .map((author) => author.trim())
      .filter(Boolean),
    publicationYear: form.publicationYear.trim()
      ? Number(form.publicationYear)
      : null,
    containerTitle: emptyToNull(form.containerTitle),
    publisher: emptyToNull(form.publisher),
    doi: emptyToNull(form.doi),
    url: emptyToNull(form.url),
    volume: emptyToNull(form.volume),
    issue: emptyToNull(form.issue),
    pages: emptyToNull(form.pages),
  }
}

function MetadataInput({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: CitationMetadataUpdateField
  label: string
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={`citation-${id}`}>{label}</Label>
      <Input
        id={`citation-${id}`}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `citation-${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <p id={`citation-${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function CitationMetadataEditor({
  paper,
  open,
  onOpenChange,
}: {
  paper: Paper
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [form, setForm] = useState(() => formFromPaper(paper))
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<CitationMetadataUpdateField, string>>
  >({})
  const [formError, setFormError] = useState<string | null>(null)
  const update = useUpdateCitationMetadata()

  function close() {
    setForm(formFromPaper(paper))
    setFieldErrors({})
    setFormError(null)
    onOpenChange(false)
  }

  function change(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
  }

  async function save() {
    setFieldErrors({})
    setFormError(null)
    try {
      const result = await update.mutateAsync(requestFromForm(paper.id, form))
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {})
        setFormError(
          result.error === 'unauthenticated'
            ? 'Your session has expired. Sign in again to save citation metadata.'
            : result.error === 'not_found'
              ? 'This paper is no longer available.'
              : result.error === 'invalid_request'
                ? 'Check the highlighted citation metadata.'
                : 'Citation metadata could not be saved right now.',
        )
        return
      }
      onOpenChange(false)
    } catch {
      setFormError('Citation metadata could not be saved right now.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit citation metadata</DialogTitle>
          <DialogDescription>
            Enter bibliographic details exactly as they should appear. Missing fields are allowed.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5 sm:col-span-2">
            <Label htmlFor="citation-authors">Authors, one per line</Label>
            <Textarea
              id="citation-authors"
              value={form.authors}
              rows={4}
              aria-invalid={Boolean(fieldErrors.authors)}
              aria-describedby={fieldErrors.authors ? 'citation-authors-error' : undefined}
              onChange={(event) => change('authors', event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Preserve the published order. Organizations can be entered as one author.
            </p>
            {fieldErrors.authors && (
              <p id="citation-authors-error" className="text-xs text-destructive">
                {fieldErrors.authors}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <MetadataInput
              id="citationTitle"
              label="Citation title"
              value={form.citationTitle}
              error={fieldErrors.citationTitle}
              onChange={(value) => change('citationTitle', value)}
            />
          </div>
          <MetadataInput
            id="publicationYear"
            label="Publication year"
            value={form.publicationYear}
            error={fieldErrors.publicationYear}
            onChange={(value) => change('publicationYear', value)}
          />
          <MetadataInput
            id="containerTitle"
            label="Container or publication"
            value={form.containerTitle}
            error={fieldErrors.containerTitle}
            onChange={(value) => change('containerTitle', value)}
          />
          <MetadataInput id="publisher" label="Publisher" value={form.publisher} error={fieldErrors.publisher} onChange={(value) => change('publisher', value)} />
          <MetadataInput id="doi" label="DOI" value={form.doi} error={fieldErrors.doi} onChange={(value) => change('doi', value)} />
          <div className="sm:col-span-2">
            <MetadataInput id="url" label="Source URL" value={form.url} error={fieldErrors.url} onChange={(value) => change('url', value)} />
          </div>
          <MetadataInput id="volume" label="Volume" value={form.volume} error={fieldErrors.volume} onChange={(value) => change('volume', value)} />
          <MetadataInput id="issue" label="Issue" value={form.issue} error={fieldErrors.issue} onChange={(value) => change('issue', value)} />
          <MetadataInput id="pages" label="Pages" value={form.pages} error={fieldErrors.pages} onChange={(value) => change('pages', value)} />
        </div>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={update.isPending} onClick={close}>
            Cancel
          </Button>
          <Button type="button" disabled={update.isPending} onClick={() => void save()}>
            {update.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
            {update.isPending ? 'Saving…' : 'Save citation metadata'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CitationMetadataCard({ paper }: { paper: Paper }) {
  const [editing, setEditing] = useState(false)
  const metadata = paperRowToCitationMetadata(paper)
  const completeness = assessCitationMetadataCompleteness(metadata)
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="size-4" aria-hidden="true" /> Citation metadata
          </CardTitle>
          <CardDescription>
            Deterministic numeric preview using only saved metadata.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
          <Pencil aria-hidden="true" /> Edit citation metadata
        </Button>
      </CardHeader>
      <CardContent className="min-w-0 space-y-3">
        <Badge variant={completeness.status === 'complete_enough' ? 'secondary' : 'outline'}>
          {completeness.status === 'complete_enough'
            ? 'Complete enough'
            : 'Incomplete citation metadata'}
        </Badge>
        <p className="rounded-lg border bg-muted/20 p-3 text-sm break-words">
          {formatNumericReference(1, metadata)}
        </p>
        {completeness.missingImportantFields.length > 0 && (
          <p className="text-xs break-words text-muted-foreground">
            Missing: {completeness.missingImportantFields
              .map((field) => IMPORTANT_FIELD_LABELS[field])
              .join(', ')}.
          </p>
        )}
      </CardContent>
      <CitationMetadataEditor paper={paper} open={editing} onOpenChange={setEditing} />
    </Card>
  )
}
