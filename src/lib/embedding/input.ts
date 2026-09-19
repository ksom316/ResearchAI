/**
 * Builds the text that is embedded for a stored chunk: the "ctx-v1" input profile.
 *
 * A chunk taken out of its paper loses context ("Results" of what?). Prefixing the
 * paper and section title gives the embedding model that context. The exact
 * template below IS the profile: changing it changes the vector space, so it
 * requires a new profile id (e.g. ctx-v2) and re-embedding.
 *
 * ctx-v1 format (a blank line separates the header from the chunk text):
 *
 *   Title: <paper title>
 *   Section: <section title>
 *
 *   <chunk text, exactly as stored>
 *
 * A blank/missing title or section drops its whole line. Only the header values are
 * normalized (whitespace collapsed, length capped); the chunk text is used as-is.
 * No IDs, user IDs, storage paths or timestamps are ever included.
 */

export const INPUT_PROFILE_CTX_V1 = 'ctx-v1'

/** Cap for header values, so an unusually long title cannot dominate the input. */
export const MAX_HEADER_VALUE_CHARS = 300

export type DocumentInputFields = {
  paperTitle: string | null | undefined
  sectionTitle: string | null | undefined
  /** The chunk text, exactly as stored in paper_chunks.text. */
  text: string
}

function headerValue(value: string | null | undefined): string {
  const collapsed = (value ?? '').replace(/\s+/g, ' ').trim()
  return collapsed.length > MAX_HEADER_VALUE_CHARS
    ? `${collapsed.slice(0, MAX_HEADER_VALUE_CHARS).trimEnd()}…`
    : collapsed
}

/** Deterministic ctx-v1 embedding input for one chunk. */
export function buildDocumentInput(fields: DocumentInputFields): string {
  if (fields.text.trim() === '') {
    throw new RangeError(
      'Cannot build an embedding input from empty chunk text',
    )
  }
  const title = headerValue(fields.paperTitle)
  const section = headerValue(fields.sectionTitle)
  const header = [
    title === '' ? null : `Title: ${title}`,
    section === '' ? null : `Section: ${section}`,
  ].filter((line): line is string => line !== null)

  return header.length === 0
    ? fields.text
    : `${header.join('\n')}\n\n${fields.text}`
}
