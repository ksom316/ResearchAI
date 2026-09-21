import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Loader2, PenLine } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { Skeleton } from '#/components/ui/skeleton'
import { QueryError } from '#/components/query-error'
import { papersQuery } from '#/features/papers/queries'
import { buildWriterRequest, writerResultMessage } from '../presentation'
import type { WriterFormState } from '../presentation'
import type { WriterGenerationResult } from '../types'
import { generateWriterDraftFn } from '../writer.functions'
import { GroundedDraftView } from './grounded-draft-view'
import type { WriterCitationSelection } from './grounded-draft-view'
import { WriterCitationSheet } from './writer-citation-sheet'
import { WriterConfiguration } from './writer-configuration'

const INITIAL_FORM: WriterFormState = {
  mode: 'literature_synthesis',
  focus: '',
  paperIds: [],
}

export function AcademicWriterTab({ projectId }: { projectId: string }) {
  const papers = useQuery(papersQuery({ projectId }))
  const [form, setForm] = useState<WriterFormState>(INITIAL_FORM)
  const [result, setResult] = useState<WriterGenerationResult | null>(null)
  const [generating, setGenerating] = useState(false)
  const [selection, setSelection] = useState<WriterCitationSelection | null>(null)
  const request = buildWriterRequest(projectId, form)

  function updateForm(next: WriterFormState) {
    setForm(next)
    setResult(null)
    setSelection(null)
  }

  async function generate() {
    if (!request || generating) return
    setResult(null)
    setSelection(null)
    setGenerating(true)
    try {
      setResult(await generateWriterDraftFn({ data: request }))
    } catch {
      setResult({ ok: false, error: 'writer_unavailable' })
    } finally {
      setGenerating(false)
    }
  }

  if (papers.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    )
  }
  if (papers.error) return <QueryError error={papers.error} onRetry={() => void papers.refetch()} />

  const message = result ? writerResultMessage(result) : null
  return (
    <div className="min-w-0 space-y-5">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <PenLine className="size-5" aria-hidden="true" /> Academic Writer
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Generate short academic drafts grounded only in evidence from papers in this research project.
        </p>
      </header>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Configure draft</CardTitle>
          <CardDescription>
            ResearchAI will abstain when the available project evidence is insufficient.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <WriterConfiguration
            value={form}
            papers={papers.data}
            disabled={generating}
            onChange={updateForm}
          />
          <Button
            type="button"
            disabled={!request || generating}
            className="w-full sm:w-auto"
            onClick={() => void generate()}
          >
            {generating ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <PenLine aria-hidden="true" />
            )}
            {generating ? 'Generating grounded draft…' : 'Generate grounded draft'}
          </Button>
        </CardContent>
      </Card>

      <section aria-live="polite" aria-busy={generating} className="min-w-0">
        {generating && (
          <div role="status" className="space-y-3 rounded-xl border p-5">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Retrieving project evidence and verifying a grounded draft…
            </p>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        )}
        {!generating && !result && (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <p className="text-sm font-medium">Your grounded draft will appear here.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Generated statements are shown only after their citations pass server validation.
            </p>
          </div>
        )}
        {!generating && message && (
          <div
            role={result && !result.ok ? 'alert' : 'status'}
            className="flex items-start gap-2 rounded-xl border border-dashed p-5 text-sm text-muted-foreground"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{message}</p>
          </div>
        )}
        {!generating && result?.ok && result.status === 'generated' && (
          <GroundedDraftView draft={result.draft} onSelectCitation={setSelection} />
        )}
      </section>

      <WriterCitationSheet
        projectId={projectId}
        selection={selection}
        onClose={() => setSelection(null)}
      />
    </div>
  )
}
