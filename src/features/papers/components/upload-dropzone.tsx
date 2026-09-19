import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { AlertCircle, Info, Loader2, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { useUploadPaper } from '../queries'
import { validatePdf } from '../validation'

type Progress = { name: string; index: number; total: number; pct: number }

/**
 * PDF upload area. Files upload one at a time; while anything is in flight the
 * picker and drop target are disabled so a submission can't be duplicated.
 */
export function UploadDropzone({ projectId }: { projectId?: string }) {
  const upload = useUploadPaper()
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [notices, setNotices] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const busy = progress !== null

  async function handleFiles(fileList: FileList | File[]) {
    if (busyRef.current) return
    const files = Array.from(fileList)
    if (files.length === 0) return
    busyRef.current = true
    setErrors([])
    setNotices([])

    const problems: string[] = []
    const valid: File[] = []
    for (const file of files) {
      const problem = await validatePdf(file)
      if (problem) problems.push(problem)
      else valid.push(file)
    }

    const info: string[] = []
    let succeeded = 0
    for (const [i, file] of valid.entries()) {
      setProgress({
        name: file.name,
        index: i + 1,
        total: valid.length,
        pct: 0,
      })
      try {
        const result = await upload.mutateAsync({
          file,
          projectId: projectId ?? null,
          onProgress: (f) =>
            setProgress((p) => p && { ...p, pct: Math.round(f * 100) }),
        })
        if (result.kind === 'created') {
          succeeded++
        } else {
          const t = `“${result.paper.title}”`
          info.push(
            result.linkedToProject
              ? `“${file.name}” is already in your library as ${t}, so it was added to this project without uploading it again.`
              : result.alreadyInProject
                ? `“${file.name}” already exists in this project as ${t}. Nothing was uploaded.`
                : `“${file.name}” already exists in your library as ${t}. Nothing was uploaded.`,
          )
        }
      } catch (e) {
        problems.push(
          `“${file.name}”: ${e instanceof Error ? e.message : 'Upload failed.'}`,
        )
      }
    }

    setProgress(null)
    setErrors(problems)
    setNotices(info)
    busyRef.current = false
    if (inputRef.current) inputRef.current.value = ''
    if (succeeded > 0) {
      toast.success(
        succeeded === 1 ? 'Paper uploaded' : `${succeeded} papers uploaded`,
      )
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (!busy) void handleFiles(e.dataTransfer.files)
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        aria-busy={busy}
        className={cn(
          'flex flex-col items-center rounded-xl border border-dashed bg-muted/40 px-6 py-8 text-center transition-colors',
          dragging && 'border-primary bg-accent/50',
        )}
      >
        <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-background text-muted-foreground shadow-sm">
          {busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <UploadCloud className="size-5" />
          )}
        </span>
        <p className="font-medium">
          {busy ? `Uploading ${progress.name}` : 'Upload PDF papers'}
        </p>
        {busy ? (
          <div className="mt-3 w-full max-w-xs space-y-1.5">
            <div
              role="progressbar"
              aria-valuenow={progress.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 overflow-hidden rounded-full bg-secondary"
            >
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {progress.pct}%
              {progress.total > 1 &&
                ` · file ${progress.index} of ${progress.total}`}
            </p>
          </div>
        ) : (
          <>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Drag and drop PDFs here, or browse. PDF only, up to 50 MB each.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => inputRef.current?.click()}
            >
              Choose files
            </Button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          disabled={busy}
          onChange={(e) => e.target.files && void handleFiles(e.target.files)}
        />
      </div>

      {notices.length > 0 && (
        <div
          role="status"
          className="flex gap-3 rounded-lg border bg-accent/40 p-4 text-sm"
        >
          <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <ul className="space-y-1">
            {notices.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {errors.length > 0 && (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <ul className="space-y-1">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
