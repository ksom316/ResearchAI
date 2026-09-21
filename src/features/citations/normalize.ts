import {
  CITATION_METADATA_LIMITS,
  CITATION_PUBLICATION_YEAR_MAX,
  CITATION_PUBLICATION_YEAR_MIN,
  IMPORTANT_CITATION_FIELDS,
} from './types'
import type {
  CitationMetadataCompleteness,
  ImportantCitationField,
  PaperCitationMetadata,
  PaperCitationMetadataInput,
} from './types'

const UNSAFE_TEXT = /[\p{Cc}\p{Cf}]/gu
const DOI_PREFIX = /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i
const DOI_SHAPE = /^10\.\d{4,9}\/[A-Z0-9][A-Z0-9._;()/:+-]*$/i
const keepTextWhitespace = (character: string) =>
  character === '\n' || character === '\t' ? character : ''

function normalizedText(value: string, maxChars: number): string {
  return value
    .normalize('NFKC')
    .replace(UNSAFE_TEXT, keepTextWhitespace)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars)
    .trim()
}

function optionalText(
  value: string | null | undefined,
  maxChars: number,
): string | null {
  if (typeof value !== 'string') return null
  return normalizedText(value, maxChars) || null
}

export function normalizeCitationDoi(
  value: string | null | undefined,
): string | null {
  const candidate = optionalText(value, CITATION_METADATA_LIMITS.doi)
    ?.replace(DOI_PREFIX, '')
    .trim()
  if (!candidate || !DOI_SHAPE.test(candidate)) return null
  return candidate.toLowerCase()
}

export function citationDoiUrl(
  value: string | null | undefined,
): string | null {
  const doi = normalizeCitationDoi(value)
  return doi ? `https://doi.org/${doi}` : null
}

export function normalizeCitationUrl(
  value: string | null | undefined,
): string | null {
  const candidate = optionalText(value, CITATION_METADATA_LIMITS.url)
  if (!candidate) return null
  try {
    const parsed = new URL(candidate)
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password
    ) {
      return null
    }
    const normalized = parsed.toString()
    return normalized.length <= CITATION_METADATA_LIMITS.url
      ? normalized
      : null
  } catch {
    return null
  }
}

export function normalizePaperCitationMetadata(
  input: PaperCitationMetadataInput,
): PaperCitationMetadata {
  const authors = (input.authors ?? [])
    .slice(0, CITATION_METADATA_LIMITS.authors)
    .map((author) => normalizedText(author, CITATION_METADATA_LIMITS.author))
    .filter((author) => author.length > 0)
  const rawYear = input.publicationYear
  const publicationYear =
    typeof rawYear === 'number' &&
    Number.isInteger(rawYear) &&
    rawYear >= CITATION_PUBLICATION_YEAR_MIN &&
    rawYear <= CITATION_PUBLICATION_YEAR_MAX
      ? rawYear
      : null

  return {
    paperId: input.paperId,
    title: optionalText(input.title, CITATION_METADATA_LIMITS.title) ?? '',
    authors,
    publicationYear,
    containerTitle: optionalText(
      input.containerTitle,
      CITATION_METADATA_LIMITS.containerTitle,
    ),
    publisher: optionalText(
      input.publisher,
      CITATION_METADATA_LIMITS.publisher,
    ),
    doi: normalizeCitationDoi(input.doi),
    url: normalizeCitationUrl(input.url),
    volume: optionalText(input.volume, CITATION_METADATA_LIMITS.volume),
    issue: optionalText(input.issue, CITATION_METADATA_LIMITS.issue),
    pages: optionalText(input.pages, CITATION_METADATA_LIMITS.pages),
  }
}

export function assessCitationMetadataCompleteness(
  input: PaperCitationMetadataInput,
): CitationMetadataCompleteness {
  const metadata = normalizePaperCitationMetadata(input)
  const missing: ImportantCitationField[] = []
  if (!metadata.title) missing.push('title')
  if (metadata.authors.length === 0) missing.push('authors')
  if (metadata.publicationYear === null) missing.push('publicationYear')
  return {
    status: missing.length === 0 ? 'complete_enough' : 'incomplete',
    missingImportantFields: IMPORTANT_CITATION_FIELDS.filter((field) =>
      missing.includes(field),
    ),
  }
}
