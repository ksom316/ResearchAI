import { Check, FileText } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import type { Paper } from '#/features/papers/types'
import { MAX_WRITER_FOCUS_CHARS } from '../schemas'
import {
  WRITER_MODE_OPTIONS,
  toggleWriterPaper,
} from '../presentation'
import type { WriterFormState } from '../presentation'
import type { WriterMode } from '../types'

const usesPapers = (mode: WriterMode) => mode !== 'literature_synthesis'

export function WriterConfiguration({
  value,
  papers,
  disabled,
  onChange,
}: {
  value: WriterFormState
  papers: readonly Paper[]
  disabled: boolean
  onChange: (next: WriterFormState) => void
}) {
  const compare = value.mode === 'compare_studies'
  return (
    <div className="space-y-5">
      <fieldset disabled={disabled}>
        <legend className="text-sm font-semibold">Writing mode</legend>
        <div
          className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
          role="radiogroup"
          aria-label="Writing mode"
        >
          {WRITER_MODE_OPTIONS.map((option) => {
            const selected = value.mode === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={cn(
                  'min-w-0 rounded-lg border p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'bg-card hover:bg-muted/50',
                )}
                onClick={() =>
                  onChange({ mode: option.value, focus: '', paperIds: [] })
                }
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="mt-1 block text-xs break-words text-muted-foreground">
                  {option.description}
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      {value.mode === 'literature_synthesis' && (
        <div className="space-y-2">
          <Label htmlFor="writer-focus">Focus or topic</Label>
          <Textarea
            id="writer-focus"
            value={value.focus}
            maxLength={MAX_WRITER_FOCUS_CHARS}
            rows={3}
            disabled={disabled}
            aria-describedby="writer-focus-help"
            placeholder="e.g. Approaches to table structure recognition"
            onChange={(event) =>
              onChange({ ...value, focus: event.target.value })
            }
          />
          <p id="writer-focus-help" className="text-xs text-muted-foreground">
            Required. At least two relevant project papers must support the topic.
          </p>
        </div>
      )}

      {usesPapers(value.mode) && (
        <fieldset disabled={disabled} className="min-w-0 space-y-2">
          <legend className="text-sm font-semibold">
            Papers {compare ? '(select 2–5)' : '(optional, up to 5)'}
          </legend>
          <p className="text-xs text-muted-foreground">
            {compare
              ? 'Choose the studies to compare.'
              : 'Leave all unselected to use all eligible papers in this project.'}
          </p>
          {papers.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No papers are linked to this project yet.
            </p>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              {papers.map((paper) => {
                const selected = value.paperIds.includes(paper.id)
                const blocked = !selected && value.paperIds.length >= 5
                return (
                  <Button
                    key={paper.id}
                    type="button"
                    variant={selected ? 'secondary' : 'outline'}
                    aria-pressed={selected}
                    aria-label={`${selected ? 'Remove' : 'Select'} ${paper.title}`}
                    disabled={disabled || blocked}
                    className="h-auto min-w-0 justify-start gap-2 py-2 text-left whitespace-normal"
                    onClick={() =>
                      onChange({
                        ...value,
                        paperIds: toggleWriterPaper(value.paperIds, paper.id),
                      })
                    }
                  >
                    {selected ? (
                      <Check className="size-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <FileText className="size-4 shrink-0" aria-hidden="true" />
                    )}
                    <span className="min-w-0 break-words">{paper.title}</span>
                  </Button>
                )
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {value.paperIds.length} of 5 selected
          </p>
        </fieldset>
      )}
    </div>
  )
}
