import { Card, CardContent } from '#/components/ui/card'
import { PaperList } from '#/features/papers/components/paper-list'
import { UploadDropzone } from '#/features/papers/components/upload-dropzone'

export function PapersTab({ projectId }: { projectId: string }) {
  return (
    <div className="space-y-4">
      <UploadDropzone />
      <Card>
        <CardContent>
          <PaperList
            projectId={projectId}
            emptyDescription="No papers are linked to this project yet."
          />
        </CardContent>
      </Card>
    </div>
  )
}
