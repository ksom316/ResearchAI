import { UploadCloud } from 'lucide-react'
import { Badge } from '#/components/ui/badge'

/**
 * Placeholder for the future PDF upload flow. It is intentionally inert:
 * upload, storage writes, and document processing are not part of Phase 1.
 */
export function UploadDropzone() {
  return (
    <div
      aria-disabled="true"
      className="flex flex-col items-center rounded-xl border border-dashed bg-muted/40 px-6 py-8 text-center"
    >
      <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm">
        <UploadCloud className="size-5" />
      </span>
      <p className="font-medium">Upload PDF papers</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Drag and drop academic PDFs here to add them to your library.
      </p>
      <Badge variant="secondary" className="mt-3">
        Coming soon
      </Badge>
    </div>
  )
}
