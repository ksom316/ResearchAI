import { citationDoiUrl, normalizePaperCitationMetadata } from './normalize'
import {
  derivePaperReferenceNumbering,
  referenceNumbersForEvidence,
} from './numbering'
import type {
  CitationDraftUsage,
  PaperCitationMetadataInput,
  PaperReferenceGroup,
} from './types'

export function formatCitationAuthors(authors: readonly string[]): string {
  if (authors.length === 0) return ''
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`
  return `${authors.slice(0, -1).join(', ')}, and ${authors.at(-1)}`
}

/** Deterministic IEEE-compatible numeric output using only supplied metadata. */
export function formatNumericReference(
  number: number,
  input: PaperCitationMetadataInput,
): string {
  const metadata = normalizePaperCitationMetadata(input)
  const trailing: string[] = []
  if (metadata.containerTitle) trailing.push(metadata.containerTitle)
  if (metadata.volume) trailing.push(`vol. ${metadata.volume}`)
  if (metadata.issue) trailing.push(`no. ${metadata.issue}`)
  if (metadata.pages) trailing.push(`pp. ${metadata.pages}`)
  if (metadata.publisher) trailing.push(metadata.publisher)
  if (metadata.publicationYear !== null) {
    trailing.push(String(metadata.publicationYear))
  }

  const authors = formatCitationAuthors(metadata.authors)
  let body = authors
  if (metadata.title) {
    if (body) body += ', '
    body +=
      trailing.length > 0
        ? `“${metadata.title},”`
        : `“${metadata.title}.”`
  }
  if (trailing.length > 0) {
    if (body) body += ' '
    body += `${trailing.join(', ')}.`
  } else if (body && !body.endsWith('.”')) {
    body += '.'
  }

  let reference = `[${number}]`
  if (body) reference += ` ${body}`
  const link = citationDoiUrl(metadata.doi) ?? metadata.url
  return link ? `${reference} ${link}` : reference
}

export function formatNumericCitationMarkers(numbers: readonly number[]): string {
  return numbers.map((number) => `[${number}]`).join(' ')
}

export function formatNumericReferenceList(
  references: readonly PaperReferenceGroup[],
  metadata: readonly PaperCitationMetadataInput[],
): string {
  const byPaper = new Map(metadata.map((entry) => [entry.paperId, entry]))
  return references
    .map((reference) =>
      formatNumericReference(
        reference.number,
        byPaper.get(reference.paperId) ?? {
          paperId: reference.paperId,
          title: '',
        },
      ),
    )
    .join('\n')
}

/** Pure copy primitive; Writer UI integration is intentionally deferred. */
export function formatNumericDraftCopy(
  draft: CitationDraftUsage,
  metadata: readonly PaperCitationMetadataInput[],
): string {
  const numbering = derivePaperReferenceNumbering(draft)
  const prose = draft.paragraphs
    .map((paragraph) =>
      paragraph.units
        .map((unit) => {
          const markers = formatNumericCitationMarkers(
            referenceNumbersForEvidence(unit.citationIds, numbering),
          )
          return `${unit.text}${markers ? ` ${markers}` : ''}`
        })
        .join(' '),
    )
    .join('\n\n')
  if (numbering.references.length === 0) return prose
  return `${prose}\n\nReferences\n\n${formatNumericReferenceList(
    numbering.references,
    metadata,
  )}`
}
