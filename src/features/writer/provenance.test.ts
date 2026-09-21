import { describe, expect, it, vi } from 'vitest'
import type { WriterDb } from './writer-db.server'
import { resolveWriterProvenance } from './provenance'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const PAPER = '22222222-2222-4222-8222-222222222222'
const CHUNK = '33333333-3333-4333-8333-333333333333'
const SECTION = '44444444-4444-4444-8444-444444444444'

function db(overrides: Partial<WriterDb> = {}): WriterDb {
  return {
    getUserId: vi.fn(async () => 'user'),
    getProject: vi.fn(async () => ({ id: PROJECT, title: 'Project' })),
    listProjectPapers: vi.fn(async () => [{ id: PAPER, title: 'Paper', status: 'ready' as const }]),
    listExtractionOverviews: vi.fn(async () => [{
      paperId: PAPER, schemaVersion: 1, status: 'complete' as const, sourceCompletedAt: '2026-01-01',
      completedAt: '2026-01-01', provider: null, model: null, createdAt: '2026-01-01',
      updatedAt: '2026-01-01', isStale: false,
    }]),
    listExtractionFields: vi.fn(async () => [{
      paperId: PAPER, schemaVersion: 1, fieldKey: 'findings' as const, state: 'extracted' as const,
      items: [{ text: 'Grounded finding.' }], itemsMalformed: false,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    }]),
    listExtractionSources: vi.fn(async () => [{
      paperId: PAPER, schemaVersion: 1, fieldKey: 'findings' as const, itemIndex: 0, ord: 0,
      chunkId: CHUNK, sectionId: SECTION, sectionTitle: 'Results', sectionType: 'results',
      pageStart: 3, pageEnd: 3, excerpt: 'Stored excerpt.',
    }]),
    listChunks: vi.fn(async () => [{
      id: CHUNK, paperId: PAPER, sectionId: SECTION, text: 'Live supporting text.',
      pageStart: 3, pageEnd: 3,
    }]),
    listSections: vi.fn(async () => [{
      id: SECTION, paperId: PAPER, title: 'Results', sectionType: 'results',
      pageStart: 3, pageEnd: 3,
    }]),
    ...overrides,
  }
}

describe('lazy Writer provenance', () => {
  it('revalidates project linkage and resolves chunk evidence', async () => {
    const result = await resolveWriterProvenance({
      projectId: PROJECT,
      locator: { kind: 'chunk', paperId: PAPER, chunkId: CHUNK, sectionId: SECTION },
    }, { db: db() })
    expect(result).toMatchObject({
      ok: true,
      provenance: { kind: 'chunk', paperId: PAPER, claimText: null },
    })
    if (result.ok) expect(result.provenance.sources[0]?.content).toBe('Live supporting text.')
  })

  it('resolves the exact extraction claim and its source records', async () => {
    const result = await resolveWriterProvenance({
      projectId: PROJECT,
      locator: {
        kind: 'extraction_claim', paperId: PAPER, schemaVersion: 1,
        fieldKey: 'findings', itemIndex: 0,
      },
    }, { db: db() })
    expect(result).toMatchObject({
      ok: true,
      provenance: {
        kind: 'extraction_claim', fieldKey: 'findings',
        claimText: 'Grounded finding.',
      },
    })
  })

  it('fails safely for an unlinked paper or stale extraction', async () => {
    const unlinked = await resolveWriterProvenance({
      projectId: PROJECT,
      locator: { kind: 'chunk', paperId: PAPER, chunkId: CHUNK, sectionId: SECTION },
    }, { db: db({ listProjectPapers: vi.fn(async () => []) }) })
    expect(unlinked).toEqual({ ok: false, error: 'not_found' })

    const stale = await resolveWriterProvenance({
      projectId: PROJECT,
      locator: {
        kind: 'extraction_claim', paperId: PAPER, schemaVersion: 1,
        fieldKey: 'findings', itemIndex: 0,
      },
    }, {
      db: db({
        listExtractionOverviews: vi.fn(async () => [{
          paperId: PAPER, schemaVersion: 1, status: 'complete' as const, sourceCompletedAt: '2026-01-01',
          completedAt: '2026-01-01', provider: null, model: null, createdAt: '2026-01-01',
          updatedAt: '2026-01-01', isStale: true,
        }]),
      }),
    })
    expect(stale).toEqual({ ok: false, error: 'not_found' })
  })

  it('rejects malformed locator input before database access', async () => {
    const mocked = db()
    const result = await resolveWriterProvenance({ projectId: PROJECT, locator: { kind: 'chunk' } }, {
      db: mocked,
    })
    expect(result).toEqual({ ok: false, error: 'invalid_request' })
    expect(mocked.getUserId).not.toHaveBeenCalled()
  })
})
