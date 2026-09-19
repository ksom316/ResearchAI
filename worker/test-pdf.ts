/**
 * Builds a tiny valid PDF in memory for tests (no fixture files are committed).
 *
 * Each page is either a list of text lines (top to bottom, one column), or an
 * object for richer layouts:
 *  - `lines` may contain `{ text, x, y }` entries for explicit positioning
 *    (e.g. two-column pages);
 *  - `image: true` paints a 1x1 inline image and no text, like a scanned page.
 */
export type TestLine = string | { text: string; x: number; y: number }
export type TestPage = TestLine[] | { lines?: TestLine[]; image?: boolean }

export function buildPdf(pages: TestPage[]): Uint8Array {
  const escape = (s: string) => s.replace(/([\\()])/g, '\\$1')
  const objects: string[] = []
  const add = (body: string) => objects.push(body) // object number = index + 1

  // 1 catalog, 2 page tree, 3 font; page i uses objects 4 + 2i (page) and 5 + 2i (content)
  add('<< /Type /Catalog /Pages 2 0 R >>')
  const kids = pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  pages.forEach((page, i) => {
    const spec = Array.isArray(page) ? { lines: page } : page
    const lines = spec.lines ?? []
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`,
    )
    const ops = lines
      .map((line, n) => {
        const { text, x, y } =
          typeof line === 'string'
            ? { text: line, x: 72, y: 720 - n * 14 }
            : line
        return `1 0 0 1 ${x} ${y} Tm (${escape(text)}) Tj`
      })
      .join('\n')
    let stream = lines.length ? `BT /F1 12 Tf\n${ops}\nET` : ''
    if (spec.image) {
      stream +=
        '\nq 612 0 0 792 0 0 cm\nBI /W 1 /H 1 /CS /G /BPC 8 ID ' +
        String.fromCharCode(0x80) +
        ' EI\nQ'
    }
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  // latin1 so byte values (e.g. the inline image data) are preserved 1:1
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff)
}
