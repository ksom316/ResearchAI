import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '#/components/page-header'
import { Card, CardContent } from '#/components/ui/card'
import { PaperList } from '#/features/papers/components/paper-list'
import { UploadDropzone } from '#/features/papers/components/upload-dropzone'

export const Route = createFileRoute('/_authed/library')({
  head: () => ({ meta: [{ title: 'Library · ResearchAI' }] }),
  component: LibraryPage,
})

function LibraryPage() {
  return (
    <>
      <PageHeader
        title="Library"
        description="Every paper you've collected, across all projects."
      />
      <div className="space-y-6">
        <UploadDropzone />
        <Card>
          <CardContent>
            <PaperList emptyDescription="Your library is empty. PDF uploads are coming soon." />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
