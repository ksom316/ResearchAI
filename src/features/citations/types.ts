export const CITATION_METADATA_LIMITS = {
  title: 500,
  authors: 50,
  author: 200,
  containerTitle: 500,
  publisher: 300,
  doi: 255,
  url: 2_048,
  volume: 50,
  issue: 50,
  pages: 100,
} as const

export const CITATION_PUBLICATION_YEAR_MIN = 1000
export const CITATION_PUBLICATION_YEAR_MAX = 3000

/** Provider- and database-independent bibliographic data for one paper. */
export type PaperCitationMetadata = {
  paperId: string
  title: string
  authors: string[]
  publicationYear: number | null
  containerTitle: string | null
  publisher: string | null
  doi: string | null
  url: string | null
  volume: string | null
  issue: string | null
  pages: string | null
}

export type PaperCitationMetadataInput = {
  paperId: string
  title?: string | null
  authors?: readonly string[] | null
  publicationYear?: number | null
  containerTitle?: string | null
  publisher?: string | null
  doi?: string | null
  url?: string | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
}

export const IMPORTANT_CITATION_FIELDS = [
  'title',
  'authors',
  'publicationYear',
] as const

export type ImportantCitationField =
  (typeof IMPORTANT_CITATION_FIELDS)[number]

export type CitationMetadataCompleteness = {
  status: 'complete_enough' | 'incomplete'
  missingImportantFields: ImportantCitationField[]
}

export type CitationEvidenceIdentity = string

/** Structural subset of a validated Writer draft; it deliberately avoids a Writer import. */
export type CitationDraftUsage = {
  paragraphs: readonly {
    units: readonly {
      text: string
      citationIds: readonly CitationEvidenceIdentity[]
    }[]
  }[]
  citations: readonly {
    id: CitationEvidenceIdentity
    paperId: string
  }[]
}

export type PaperReferenceGroup = {
  paperId: string
  number: number
  /** Distinct evidence identities, retained in first-use order. */
  evidenceIds: CitationEvidenceIdentity[]
}

export type PaperReferenceNumbering = {
  references: PaperReferenceGroup[]
  numberByPaperId: ReadonlyMap<string, number>
  numberByEvidenceId: ReadonlyMap<CitationEvidenceIdentity, number>
}
