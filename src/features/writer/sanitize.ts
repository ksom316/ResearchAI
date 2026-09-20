const UNSAFE = /[\p{Cc}\p{Cf}]/gu
const WRITER_ID = /\bW\s*\d{1,6}\b/giu
const DELIMITER = /<{3,}|>{3,}|`{3,}/g

const keepWhitespace = (character: string) =>
  character === '\n' || character === '\t' ? character : ''

/** Sanitizes untrusted text without treating it as markup or instructions. */
export function sanitizeWriterText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(UNSAFE, keepWhitespace)
    .replace(WRITER_ID, '[writer citation removed]')
    .replace(DELIMITER, '[delimiter removed]')
}

export function sanitizeWriterLine(text: string, maxChars: number): string {
  return sanitizeWriterText(text).replace(/\s+/g, ' ').trim().slice(0, maxChars)
}

/** Bounded at a word boundary when practical; metadata and identifiers are separate. */
export function boundedWriterText(text: string, maxChars: number): string {
  const clean = sanitizeWriterText(text).trim()
  if (clean.length <= maxChars) return clean
  const boundary = clean.lastIndexOf(' ', maxChars - 1)
  const end = boundary >= Math.floor(maxChars / 2) ? boundary : maxChars - 1
  return `${clean.slice(0, end).trimEnd()}…`
}
