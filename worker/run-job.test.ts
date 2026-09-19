import { describe, expect, it, vi } from 'vitest'
import { ProcessingError } from '../src/features/processing/errors'
import type { PdfExtractor } from '../src/features/processing/extractor'
import type {
  ExtractedDocument,
  ProcessedDocument,
  ProcessingFailure,
} from '../src/features/processing/types'
import type { ClaimedJob, JobStore } from './job-store'
import { runNextJob } from './run-job'

const config = { maxAttempts: 3, maxPdfBytes: 1024 * 1024 }

const goodPdf = new TextEncoder().encode('%PDF-1.7\n...binary...')

const goodDoc: ExtractedDocument = {
  pageCount: 2,
  pages: [
    {
      pageNumber: 1,
      text: 'Abstract\nWe study widgets and how they behave in the wild.',
    },
    {
      pageNumber: 2,
      text: '1. Introduction\nWidgets matter because everyone relies on them.',
    },
  ],
}

const job = (attempts = 1): ClaimedJob => ({
  paperId: 'paper-1',
  userId: 'user-1',
  storagePath: 'user-1/paper-1/file.pdf',
  startedAt: '2026-01-01T00:00:00.123456+00:00',
  attempts,
})

/** A store whose calls are recorded; each method can be overridden per test. */
function fakeStore(
  overrides: Partial<JobStore> & { claimed?: ClaimedJob | null } = {},
) {
  const { claimed = job(), ...rest } = overrides
  const store = {
    claimNext: vi.fn(async () => claimed),
    download: vi.fn(async () => goodPdf),
    complete: vi.fn(async (_j: ClaimedJob, _d: ProcessedDocument) => true),
    fail: vi.fn(
      async (_j: ClaimedJob, _f: ProcessingFailure, _r: boolean) => true,
    ),
    ...rest,
  }
  return store
}

const okExtractor: PdfExtractor = { extract: async () => goodDoc }

describe('runNextJob', () => {
  it('is idle when nothing can be claimed, and touches nothing else', async () => {
    const store = fakeStore({ claimed: null })
    const result = await runNextJob({ store, extractor: okExtractor, config })
    expect(result).toEqual({ kind: 'idle' })
    expect(store.download).not.toHaveBeenCalled()
  })

  it('processes a paper end to end and only then completes it', async () => {
    const store = fakeStore()
    const result = await runNextJob({ store, extractor: okExtractor, config })

    expect(result).toMatchObject({
      kind: 'ready',
      paperId: 'paper-1',
      sections: 2,
      chunks: 2,
    })
    expect(store.complete).toHaveBeenCalledTimes(1)
    const [claimedJob, document] = vi.mocked(store.complete).mock.calls[0]
    expect(claimedJob.startedAt).toBe(job().startedAt) // fencing token passed through
    expect(document.pageCount).toBe(2)
    expect(document.sections.map((s) => s.title)).toEqual([
      'Abstract',
      '1. Introduction',
    ])
    expect(store.fail).not.toHaveBeenCalled()
  })

  it('fails without retry when the PDF has no extractable text', async () => {
    const store = fakeStore()
    const blank: PdfExtractor = {
      extract: async () => ({
        pageCount: 1,
        pages: [{ pageNumber: 1, text: '  ' }],
      }),
    }
    const result = await runNextJob({ store, extractor: blank, config })
    expect(result).toEqual({
      kind: 'failed',
      paperId: 'paper-1',
      code: 'no_extractable_text',
    })
    expect(store.complete).not.toHaveBeenCalled()
    expect(store.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: 'no_extractable_text' }),
      false,
    )
  })

  it.each([
    ['encrypted_pdf', 'The PDF is password-protected.'],
    ['invalid_pdf', 'The file could not be read as a PDF.'],
  ] as const)(
    'maps an extractor %s error to a safe stored message',
    async (code, message) => {
      const store = fakeStore()
      const extractor: PdfExtractor = {
        extract: async () => {
          throw new ProcessingError(code, message)
        },
      }
      const result = await runNextJob({ store, extractor, config })
      expect(result).toMatchObject({ kind: 'failed', code })
      expect(store.fail).toHaveBeenCalledWith(
        expect.anything(),
        { code, message },
        false,
      )
    },
  )

  it('never stores raw exception text from unexpected extractor errors', async () => {
    const store = fakeStore()
    const extractor: PdfExtractor = {
      extract: async () => {
        throw new Error('ECONNRESET at /home/me/secret.js:12')
      },
    }
    await runNextJob({ store, extractor, config })
    const failure = vi.mocked(store.fail).mock.calls[0][1]
    expect(failure.code).toBe('extraction_failed')
    expect(JSON.stringify(failure)).not.toContain('secret')
  })

  it('rejects empty, oversized and non-PDF downloads before parsing', async () => {
    const extract = vi.fn(okExtractor.extract)
    const extractor: PdfExtractor = { extract }
    for (const bytes of [
      new Uint8Array(0),
      new Uint8Array(config.maxPdfBytes + 1).fill(0x41),
      new TextEncoder().encode('<html>not a pdf</html>'),
    ]) {
      const store = fakeStore({ download: vi.fn(async () => bytes) })
      const result = await runNextJob({ store, extractor, config })
      expect(result).toMatchObject({ kind: 'failed', code: 'invalid_pdf' })
    }
    expect(extract).not.toHaveBeenCalled()
  })

  it('accepts a PDF whose header is preceded by a little junk', async () => {
    const junk = new TextEncoder().encode('\n\n  %PDF-1.4\nbody')
    const store = fakeStore({ download: vi.fn(async () => junk) })
    const result = await runNextJob({ store, extractor: okExtractor, config })
    expect(result.kind).toBe('ready')
  })

  describe('retry bounds', () => {
    const failingDownload = () =>
      vi.fn(async () => {
        throw new Error('socket hang up')
      })

    it('returns a paper to the queue after a transient download failure', async () => {
      const store = fakeStore({ claimed: job(1), download: failingDownload() })
      const result = await runNextJob({ store, extractor: okExtractor, config })
      expect(result).toEqual({
        kind: 'retry',
        paperId: 'paper-1',
        code: 'storage_error',
      })
      expect(store.fail).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        true,
      )
    })

    it('gives up (failed) once attempts are exhausted', async () => {
      const store = fakeStore({ claimed: job(3), download: failingDownload() })
      const result = await runNextJob({ store, extractor: okExtractor, config })
      expect(result).toEqual({
        kind: 'failed',
        paperId: 'paper-1',
        code: 'storage_error',
      })
      expect(store.fail).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        false,
      )
    })

    it('treats a persistence failure like a transient failure, with the same bound', async () => {
      const complete = vi.fn(async () => {
        throw new Error('connection terminated')
      })
      const first = fakeStore({ claimed: job(1), complete })
      expect(
        await runNextJob({ store: first, extractor: okExtractor, config }),
      ).toMatchObject({
        kind: 'retry',
        code: 'persistence_error',
      })
      const last = fakeStore({ claimed: job(3), complete })
      expect(
        await runNextJob({ store: last, extractor: okExtractor, config }),
      ).toMatchObject({
        kind: 'failed',
        code: 'persistence_error',
      })
    })
  })

  it('reports a lost claim without recording anything else', async () => {
    const store = fakeStore({ complete: vi.fn(async () => false) })
    const result = await runNextJob({ store, extractor: okExtractor, config })
    expect(result).toEqual({ kind: 'lost', paperId: 'paper-1' })
    expect(store.fail).not.toHaveBeenCalled()
  })

  it('reports a lost claim when recording a failure is refused', async () => {
    const store = fakeStore({
      download: vi.fn(async () => new Uint8Array(0)),
      fail: vi.fn(async () => false),
    })
    expect(await runNextJob({ store, extractor: okExtractor, config })).toEqual(
      {
        kind: 'lost',
        paperId: 'paper-1',
      },
    )
  })

  it('propagates database errors from claiming so the loop can back off', async () => {
    const store = fakeStore({
      claimNext: vi.fn(async () => {
        throw new Error('db down')
      }),
    })
    await expect(
      runNextJob({ store, extractor: okExtractor, config }),
    ).rejects.toThrow('db down')
  })

  it('never logs the service-role key or paper text', async () => {
    const lines: string[] = []
    await runNextJob({
      store: fakeStore(),
      extractor: okExtractor,
      config,
      log: (m) => lines.push(m),
    })
    const all = lines.join('\n')
    expect(all).toContain('paper-1')
    expect(all).not.toContain('widgets')
  })
})

describe('idempotent persistence (simulated store)', () => {
  it('replaces derived rows instead of duplicating them when a paper is reprocessed', async () => {
    // Mirrors complete_paper_processing: delete the paper's old rows, insert new, fenced by startedAt.
    const db = {
      sections: [] as { paperId: string; position: number }[],
      chunks: 0,
      startedAt: 'a' as string | null,
    }
    const store = fakeStore({
      complete: vi.fn(async (j: ClaimedJob, d: ProcessedDocument) => {
        if (db.startedAt !== j.startedAt) return false
        db.sections = db.sections.filter((s) => s.paperId !== j.paperId)
        db.sections.push(
          ...d.sections.map((s) => ({
            paperId: j.paperId,
            position: s.position,
          })),
        )
        db.chunks = d.chunks.length
        return true
      }),
    })
    const claimed = { ...job(), startedAt: 'a' }
    const run = () =>
      runNextJob({
        store: { ...store, claimNext: async () => claimed },
        extractor: okExtractor,
        config,
      })

    await run()
    await run() // retry of the same paper
    expect(db.sections).toHaveLength(2)
    expect(new Set(db.sections.map((s) => s.position)).size).toBe(2)

    db.startedAt = 'b' // someone else reclaimed it: the stale worker must write nothing
    const before = JSON.stringify(db)
    expect((await run()).kind).toBe('lost')
    expect(JSON.stringify(db)).toBe(before)
  })
})
