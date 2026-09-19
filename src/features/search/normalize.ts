/**
 * Canonical form of a research question: NFC, control characters removed (tabs and
 * newlines count as whitespace), whitespace collapsed, trimmed. Case is preserved.
 */
export function normalizeQuery(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}
