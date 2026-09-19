export const MAX_PDF_BYTES = 50 * 1024 * 1024
export const PDF_MIME = 'application/pdf'

/** Returns a user-facing error message, or null if the file is acceptable. */
export async function validatePdf(file: File): Promise<string | null> {
  const isPdfName = file.name.toLowerCase().endsWith('.pdf')
  if (!isPdfName || (file.type && file.type !== PDF_MIME)) {
    return `“${file.name}” is not a PDF. Only .pdf files are supported.`
  }
  if (file.size === 0) return `“${file.name}” is empty.`
  if (file.size > MAX_PDF_BYTES) {
    return `“${file.name}” is larger than the 50 MB limit.`
  }
  // Check the magic bytes so renamed non-PDF files are rejected up front.
  const header = await file.slice(0, 5).text()
  if (header !== '%PDF-') {
    return `“${file.name}” doesn’t look like a valid PDF.`
  }
  return null
}

/** Storage-safe filename: ASCII letters, digits, dot, dash, underscore. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(-120)
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`
}

/** Default title until real metadata extraction exists (later phase). */
export function titleFromFilename(name: string): string {
  const title = name
    .replace(/\.pdf$/i, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
  return title || 'Untitled paper'
}

/** SHA-256 of the file contents as lowercase hex. */
export async function hashFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
}
