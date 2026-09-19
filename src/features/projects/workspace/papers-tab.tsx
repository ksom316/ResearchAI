import { useState } from 'react'
import { Library } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { AddFromLibraryDialog } from '#/features/papers/components/add-from-library-dialog'
import { PaperList } from '#/features/papers/components/paper-list'
import { UploadDropzone } from '#/features/papers/components/upload-dropzone'

export function PapersTab({ projectId }: { projectId: string }) {
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div className="space-y-4">
      <UploadDropzone projectId={projectId} />
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setAddOpen(true)}>
          <Library /> Add from Library
        </Button>
      </div>
      <Card>
        <CardContent>
          <PaperList
            projectId={projectId}
            emptyDescription="No papers are linked to this project yet. Upload a PDF or add one from your Library."
          />
        </CardContent>
      </Card>
      <AddFromLibraryDialog
        projectId={projectId}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </div>
  )
}
