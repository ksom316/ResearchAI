import { describe, expect, it, vi } from 'vitest'
import type { CitationMetadataUpdateColumns } from './citation-metadata'
import type { CitationMetadataDb } from './citation-metadata-service'
import { updateCitationMetadata } from './citation-metadata-service'

const PAPER = '11111111-1111-4111-8111-111111111111'
const valid = {
  paperId: PAPER,
  citationTitle: 'A citation title',
  authors: ['Author One', 'Research Organization'],
  publicationYear: 2025,
  containerTitle: 'Journal of Testing',
  publisher: null,
  doi: '10.1000/Example',
  url: 'https://example.org/paper',
  volume: '2',
  issue: '1',
  pages: '1–10',
}

const returnedRow = (columns: CitationMetadataUpdateColumns) => ({
  id: PAPER,
  title: 'Stored title',
  ...columns,
})

function database(options?: {
  userId?: string | null
  missing?: boolean
  throws?: boolean
}) {
  const writeMetadata = vi.fn(
    async (_paperId: string, columns: CitationMetadataUpdateColumns) => {
      if (options?.throws) throw new Error('private database failure')
      return options?.missing ? null : returnedRow(columns)
    },
  )
  const db: CitationMetadataDb = {
    getUserId: vi.fn(async () =>
      options && 'userId' in options ? (options.userId ?? null) : 'user-1',
    ),
    updateCitationMetadata: writeMetadata,
  }
  return { db, writeMetadata }
}

describe('citation metadata update service', () => {
  it('normalizes a complete-enough update and returns server-owned metadata', async () => {
    const { db, writeMetadata } = database()
    const result = await updateCitationMetadata(valid, { db })
    expect(result).toMatchObject({
      ok: true,
      metadata: {
        paperId: PAPER,
        title: 'A citation title',
        authors: ['Author One', 'Research Organization'],
        publicationYear: 2025,
        doi: '10.1000/example',
      },
    })
    expect(writeMetadata).toHaveBeenCalledTimes(1)
    expect(writeMetadata.mock.calls[0]?.[0]).toBe(PAPER)
  })

  it('allows incomplete metadata and normalizes blanks to null', async () => {
    const { db, writeMetadata } = database()
    const result = await updateCitationMetadata(
      {
        ...valid,
        citationTitle: ' ',
        authors: [],
        publicationYear: null,
        containerTitle: '',
        doi: null,
        url: null,
        volume: '',
        issue: '',
        pages: '',
      },
      { db },
    )
    expect(result.ok).toBe(true)
    expect(writeMetadata.mock.calls[0]?.[1]).toEqual({
      authors: [],
      publication_year: null,
      citation_title: null,
      citation_container_title: null,
      citation_publisher: null,
      citation_doi: null,
      citation_url: null,
      citation_volume: null,
      citation_issue: null,
      citation_pages: null,
    })
  })

  it('preserves normalized author order', async () => {
    const { db, writeMetadata } = database()
    await updateCitationMetadata(
      { ...valid, authors: ['  Zhang Wei ', 'Organization', 'Ana Ruiz'] },
      { db },
    )
    expect(writeMetadata.mock.calls[0]?.[1].authors).toEqual([
      'Zhang Wei',
      'Organization',
      'Ana Ruiz',
    ])
  })

  it.each([
    [['Author', ' author '], 'unique'],
    [['Author', '   '], 'empty'],
  ])('rejects invalid author entries %j', async (authors, expected) => {
    const { db, writeMetadata } = database()
    const result = await updateCitationMetadata({ ...valid, authors }, { db })
    expect(result).toMatchObject({
      ok: false,
      error: 'invalid_request',
      fieldErrors: { authors: expect.stringContaining(expected) },
    })
    expect(writeMetadata).not.toHaveBeenCalled()
  })

  it.each([
    ['not-a-doi', null, 'doi'],
    [null, 'javascript:alert(1)', 'url'],
    [null, 'https://user:pass@example.org', 'url'],
  ])('rejects malformed identifier values', async (doi, url, field) => {
    const { db, writeMetadata } = database()
    const result = await updateCitationMetadata({ ...valid, doi, url }, { db })
    expect(result).toMatchObject({
      ok: false,
      error: 'invalid_request',
      fieldErrors: { [field]: expect.any(String) },
    })
    expect(writeMetadata).not.toHaveBeenCalled()
  })

  it('rejects extra browser-controlled fields before authorization', async () => {
    const { db, writeMetadata } = database()
    const result = await updateCitationMetadata(
      { ...valid, status: 'ready', storage_path: 'forged', userId: 'forged' },
      { db },
    )
    expect(result).toMatchObject({ ok: false, error: 'invalid_request' })
    expect(db.getUserId).not.toHaveBeenCalled()
    expect(writeMetadata).not.toHaveBeenCalled()
  })

  it('stops unauthenticated requests before writing', async () => {
    const { db, writeMetadata } = database({ userId: null })
    expect(await updateCitationMetadata(valid, { db })).toEqual({
      ok: false,
      error: 'unauthenticated',
    })
    expect(writeMetadata).not.toHaveBeenCalled()
  })

  it('keeps foreign and missing papers safely indistinguishable', async () => {
    const { db } = database({ missing: true })
    expect(await updateCitationMetadata(valid, { db })).toEqual({
      ok: false,
      error: 'not_found',
    })
  })

  it('maps database failures to a safe unavailable result', async () => {
    const { db } = database({ throws: true })
    expect(await updateCitationMetadata(valid, { db })).toEqual({
      ok: false,
      error: 'unavailable',
    })
  })

  it('updates only citation columns and never processing or evidence state', async () => {
    const { db, writeMetadata } = database()
    await updateCitationMetadata(valid, { db })
    const payload = writeMetadata.mock.calls[0]?.[1]
    expect(Object.keys(payload).sort()).toEqual([
      'authors',
      'citation_container_title',
      'citation_doi',
      'citation_issue',
      'citation_pages',
      'citation_publisher',
      'citation_title',
      'citation_url',
      'citation_volume',
      'publication_year',
    ])
    expect(JSON.stringify(payload)).not.toMatch(
      /status|processing|chunk|embedding|extraction|evidence|locator|storage/i,
    )
  })
})
