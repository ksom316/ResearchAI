import { useQuery } from '@tanstack/react-query'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '#/components/ui/sheet'
import type { SelectedClaims } from '../matrix-model'
import { extractionSourcesForSelection } from '../queries'
import { ClaimDetailBody } from './claim-detail-body'

/**
 * The provenance sheet. The sources query is DISABLED until a field is selected, so
 * nothing is fetched for cells nobody opened.
 */
export function ClaimDetailSheet({
  selected,
  onClose,
}: {
  selected: SelectedClaims | null
  onClose: () => void
}) {
  const sources = useQuery(
    extractionSourcesForSelection(
      selected
        ? { paperId: selected.paperId, fieldKey: selected.fieldKey }
        : null,
    ),
  )

  return (
    <Sheet
      open={selected !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-6 sm:max-w-xl"
      >
        {selected && (
          <ClaimDetailBody
            selected={selected}
            sources={sources.data}
            error={sources.error}
            onRetry={() => void sources.refetch()}
            Title={SheetTitle}
            Description={SheetDescription}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}
