import { z } from 'zod'
import {
  CITATION_METADATA_LIMITS,
  CITATION_PUBLICATION_YEAR_MAX,
  CITATION_PUBLICATION_YEAR_MIN,
} from '#/features/citations/types'
import { normalizePaperCitationMetadata } from '#/features/citations/normalize'
import {
  citationMetadataToUpdateColumns,
  paperRowToCitationMetadata,
} from './citation-metadata'
import type {
  CitationMetadataPaperRow,
  CitationMetadataUpdateColumns,
} from './citation-metadata'
import type { PaperCitationMetadata } from '#/features/citations/types'

const optional = (max: number) => z.string().max(max).nullable()

export const citationMetadataUpdateSchema = z.strictObject({
  paperId: z.uuid().transform((value) => value.toLowerCase()),
  citationTitle: optional(CITATION_METADATA_LIMITS.title),
  authors: z
    .array(z.string().max(CITATION_METADATA_LIMITS.author))
    .max(CITATION_METADATA_LIMITS.authors),
  publicationYear: z
    .number()
    .int()
    .min(CITATION_PUBLICATION_YEAR_MIN)
    .max(CITATION_PUBLICATION_YEAR_MAX)
    .nullable(),
  containerTitle: optional(CITATION_METADATA_LIMITS.containerTitle),
  publisher: optional(CITATION_METADATA_LIMITS.publisher),
  doi: optional(CITATION_METADATA_LIMITS.doi),
  url: optional(CITATION_METADATA_LIMITS.url),
  volume: optional(CITATION_METADATA_LIMITS.volume),
  issue: optional(CITATION_METADATA_LIMITS.issue),
  pages: optional(CITATION_METADATA_LIMITS.pages),
})

export type CitationMetadataUpdateRequest = z.infer<
  typeof citationMetadataUpdateSchema
>

export type CitationMetadataUpdateField =
  | 'citationTitle'
  | 'authors'
  | 'publicationYear'
  | 'containerTitle'
  | 'publisher'
  | 'doi'
  | 'url'
  | 'volume'
  | 'issue'
  | 'pages'

export type CitationMetadataUpdateResult =
  | {
      ok: true
      metadata: PaperCitationMetadata
    }
  | {
      ok: false
      error: 'invalid_request' | 'unauthenticated' | 'not_found' | 'unavailable'
      fieldErrors?: Partial<Record<CitationMetadataUpdateField, string>>
    }

export type CitationMetadataDb = {
  getUserId: () => Promise<string | null>
  updateCitationMetadata: (
    paperId: string,
    columns: CitationMetadataUpdateColumns,
  ) => Promise<CitationMetadataPaperRow | null>
}

function normalizedRequest(
  input: CitationMetadataUpdateRequest,
):
  | { ok: true; columns: CitationMetadataUpdateColumns }
  | {
      ok: false
      fieldErrors: Partial<Record<CitationMetadataUpdateField, string>>
    } {
  const metadata = normalizePaperCitationMetadata({
    paperId: input.paperId,
    title: input.citationTitle,
    authors: input.authors,
    publicationYear: input.publicationYear,
    containerTitle: input.containerTitle,
    publisher: input.publisher,
    doi: input.doi,
    url: input.url,
    volume: input.volume,
    issue: input.issue,
    pages: input.pages,
  })
  const fieldErrors: Partial<Record<CitationMetadataUpdateField, string>> = {}
  if (input.authors.some((author) => author.trim() === '')) {
    fieldErrors.authors = 'Remove empty author entries.'
  } else if (new Set(metadata.authors.map((author) => author.toLowerCase())).size !== metadata.authors.length) {
    fieldErrors.authors = 'Author entries must be unique.'
  }
  if (input.doi?.trim() && !metadata.doi) {
    fieldErrors.doi = 'Enter a valid DOI, such as 10.1000/example.'
  }
  if (input.url?.trim() && !metadata.url) {
    fieldErrors.url = 'Enter a valid http:// or https:// URL.'
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }
  return {
    ok: true,
    columns: citationMetadataToUpdateColumns(metadata),
  }
}

function schemaFieldErrors(error: z.ZodError): Partial<
  Record<CitationMetadataUpdateField, string>
> {
  const errors: Partial<Record<CitationMetadataUpdateField, string>> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && field !== 'paperId') {
      errors[field as CitationMetadataUpdateField] = 'Check this value.'
    }
  }
  return errors
}

export async function updateCitationMetadata(
  raw: unknown,
  deps: { db: CitationMetadataDb },
): Promise<CitationMetadataUpdateResult> {
  const parsed = citationMetadataUpdateSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_request',
      fieldErrors: schemaFieldErrors(parsed.error),
    }
  }
  const normalized = normalizedRequest(parsed.data)
  if (!normalized.ok) {
    return {
      ok: false,
      error: 'invalid_request',
      fieldErrors: normalized.fieldErrors,
    }
  }
  try {
    if (!(await deps.db.getUserId())) return { ok: false, error: 'unauthenticated' }
    const paper = await deps.db.updateCitationMetadata(
      parsed.data.paperId,
      normalized.columns,
    )
    if (!paper) return { ok: false, error: 'not_found' }
    return { ok: true, metadata: paperRowToCitationMetadata(paper) }
  } catch {
    return { ok: false, error: 'unavailable' }
  }
}
