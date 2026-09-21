import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { FileText, Loader2 } from 'lucide-react'
import { QueryError } from '#/components/query-error'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '#/components/ui/sheet'
import { SourceCard } from '#/features/evidence-matrix/ui/source-card'
import { humanize } from '#/lib/format'
import { getWriterCitationProvenanceFn } from '../writer.functions'
import type { WriterSourceRecord } from '../types'
import type { WriterCitationSelection } from './grounded-draft-view'

function WriterSource({ source }: { source: WriterSourceRecord }) {
  return (
    <div className="space-y-2">
      <SourceCard
        source={{
          paperId: '',
          schemaVersion: 1,
          fieldKey: 'findings',
          itemIndex: 0,
          ord: 0,
          chunkId: source.chunkId,
          sectionId: source.sectionId,
          sectionTitle: source.sectionTitle,
          sectionType: source.sectionType,
          pageStart: source.pageStart,
          pageEnd: source.pageEnd,
          excerpt: source.excerpt ?? source.content,
        }}
      />
      {source.excerpt && source.content && source.excerpt !== source.content && (
        <div className="rounded-lg border bg-muted/20 p-3 text-sm">
          <p className="text-xs font-semibold text-muted-foreground uppercase">
            Supporting chunk
          </p>
          <p className="mt-2 break-words whitespace-pre-line text-muted-foreground">
            {source.content}
          </p>
        </div>
      )}
    </div>
  )
}

function CitationDetail({
  projectId,
  selection,
}: {
  projectId: string
  selection: WriterCitationSelection
}) {
  const query = useQuery({
    queryKey: [
      'writer',
      'provenance',
      projectId,
      selection.citation.paperId,
      selection.citation.locator,
    ],
    queryFn: () =>
      getWriterCitationProvenanceFn({
        data: { projectId, locator: selection.citation.locator },
      }),
    staleTime: 60_000,
  })

  return (
    <div className="space-y-6">
      <header className="space-y-2 pr-6">
        <Badge variant="secondary">Citation [{selection.number}]</Badge>
        <SheetTitle className="break-words">{selection.citation.paperTitle}</SheetTitle>
        <SheetDescription>
          Evidence used for this generated statement. Citation presence does not by itself prove semantic entailment.
        </SheetDescription>
      </header>

      <section className="space-y-2" aria-labelledby="writer-generated-unit">
        <h3 id="writer-generated-unit" className="text-sm font-semibold">
          Generated statement
        </h3>
        <blockquote className="border-l-2 pl-3 text-sm break-words text-muted-foreground">
          {selection.unitText}
        </blockquote>
      </section>

      {query.isPending && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading source provenance…
        </p>
      )}
      {query.error && (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      )}
      {query.data && !query.data.ok && (
        <p role="status" className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          This source is no longer available. The paper or its processed evidence may have changed.
        </p>
      )}
      {query.data?.ok && (
        <div className="space-y-5">
          <section className="space-y-2" aria-labelledby="writer-evidence-kind">
            <h3 id="writer-evidence-kind" className="text-sm font-semibold">
              Evidence
            </h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Kind</dt>
              <dd>
                {query.data.provenance.kind === 'chunk'
                  ? 'Retrieved paper passage'
                  : 'Evidence Matrix claim'}
              </dd>
              {query.data.provenance.fieldKey && (
                <>
                  <dt className="text-muted-foreground">Field</dt>
                  <dd>{humanize(query.data.provenance.fieldKey)}</dd>
                </>
              )}
            </dl>
            {query.data.provenance.claimText && (
              <blockquote className="rounded-lg border bg-muted/30 p-3 text-sm break-words">
                {query.data.provenance.claimText}
              </blockquote>
            )}
          </section>
          <section className="space-y-2" aria-labelledby="writer-source-records">
            <h3 id="writer-source-records" className="text-sm font-semibold">
              Source provenance
            </h3>
            {query.data.provenance.sources.map((source, index) => (
              <WriterSource key={`${source.chunkId ?? source.sectionId}-${index}`} source={source} />
            ))}
          </section>
        </div>
      )}

      <Button asChild variant="outline" size="sm">
        <Link
          to="/papers/$paperId"
          params={{ paperId: selection.citation.paperId }}
        >
          <FileText aria-hidden="true" /> Open paper
        </Link>
      </Button>
    </div>
  )
}

export function WriterCitationSheet({
  projectId,
  selection,
  onClose,
}: {
  projectId: string
  selection: WriterCitationSelection | null
  onClose: () => void
}) {
  return (
    <Sheet open={selection !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-6 sm:max-w-2xl"
      >
        {selection && (
          <CitationDetail projectId={projectId} selection={selection} />
        )}
      </SheetContent>
    </Sheet>
  )
}
