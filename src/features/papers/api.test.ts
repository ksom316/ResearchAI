import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadPaper } from './api'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
  insertedRows: [] as Record<string, unknown>[],
}))

vi.mock('#/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1' } },
        error: null,
      })),
    },
    from: mocks.from,
  }),
}))

vi.mock('./storage-quota', () => ({
  authorizePaperUpload: mocks.authorize,
  reserveStorageUpload: mocks.reserve,
  releaseStorageReservation: mocks.release,
}))

vi.mock('./storage', () => ({
  uploadObject: mocks.upload,
  removeObject: mocks.remove,
  getSignedUrl: vi.fn(),
}))

describe('uploadPaper storage reservation path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.insertedRows.length = 0
    mocks.authorize.mockResolvedValue('user-1')
    mocks.reserve.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      usedBytes: 0,
      capacityBytes: 200,
      remainingBytes: 180,
    })
    mocks.upload.mockResolvedValue(undefined)

    let paperCall = 0
    mocks.from.mockImplementation((table: string) => {
      if (table === 'paper_project_links') {
        return {
          upsert: () => ({
            select: async () => ({
              data: [{ paper_id: 'paper-1' }],
              error: null,
            }),
          }),
        }
      }
      expect(table).toBe('papers')
      paperCall += 1
      if (paperCall === 1) {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }
      }
      return {
        insert: (row: Record<string, unknown>) => {
          mocks.insertedRows.push(row)
          return {
            select: () => ({
              single: async () => ({
                data: {
                  ...row,
                  authors: null,
                  publication_year: null,
                  status: 'uploaded',
                  page_count: null,
                  processing_error: null,
                  created_at: '2026-09-25T00:00:00.000Z',
                },
                error: null,
              }),
            }),
          }
        },
      }
    })
  })

  it('reserves quota before upload and consumes it through the paper insert', async () => {
    const file = new File(['%PDF-test'], 'paper.pdf', {
      type: 'application/pdf',
    })
    const result = await uploadPaper({ file, projectId: null })

    expect(result.kind).toBe('created')
    expect(mocks.authorize).toHaveBeenCalledWith(null)
    expect(mocks.reserve).toHaveBeenCalledWith(file.size)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upload.mock.invocationCallOrder[0],
    )
    expect(mocks.insertedRows[0]).toMatchObject({
      storage_reservation_id: '11111111-1111-4111-8111-111111111111',
      file_size_bytes: file.size,
      user_id: 'user-1',
    })
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it('authorizes a project upload before reserving storage', async () => {
    const projectId = '22222222-2222-4222-8222-222222222222'
    const file = new File(['%PDF-test'], 'paper.pdf', {
      type: 'application/pdf',
    })
    await uploadPaper({ file, projectId })

    expect(mocks.authorize).toHaveBeenCalledWith(projectId)
    expect(mocks.authorize.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reserve.mock.invocationCallOrder[0],
    )
  })
})
