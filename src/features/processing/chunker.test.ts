import { describe, expect, it } from 'vitest'
import { chunkSections, chunkText } from './chunker'
import { normalizeDocument } from './normalize'
import { detectSections } from './section-detector'

const opts = { targetChars: 200, overlapChars: 50 }
const strip = (s: string) => s.replace(/\s+/g, '')

/** Every non-whitespace character of `text` must be inside some chunk. */
function expectFullCoverage(
  text: string,
  chunks: { charStart: number; charEnd: number }[],
) {
  const covered = new Array<boolean>(text.length).fill(false)
  for (const c of chunks) {
    for (let i = c.charStart; i < c.charEnd; i++) covered[i] = true
  }
  const missing = [...text].filter((ch, i) => ch.trim() !== '' && !covered[i])
  expect(missing).toEqual([])
}

const sentence = (n: number) => `Sentence number ${n} says something useful.`
const prose = (count: number) =>
  Array.from({ length: count }, (_, i) => sentence(i)).join(' ')

describe('chunkText', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    expect(chunkText('', opts)).toEqual([])
    expect(chunkText('  \n\n \t ', opts)).toEqual([])
  })

  it('keeps short text as a single chunk', () => {
    expect(chunkText('Short text.', opts)).toEqual([
      { text: 'Short text.', charStart: 0, charEnd: 11 },
    ])
  })

  it('chunk text is exactly the slice at its offsets', () => {
    const text = prose(40)
    for (const c of chunkText(text, opts)) {
      expect(c.text).toBe(text.slice(c.charStart, c.charEnd))
    }
  })

  it('produces stable, ordered chunks that never exceed the target', () => {
    const text = prose(60)
    const chunks = chunkText(text, opts)
    expect(chunks.length).toBeGreaterThan(1)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].charStart).toBeGreaterThan(chunks[i - 1].charStart)
      expect(chunks[i].charEnd).toBeGreaterThan(chunks[i - 1].charEnd)
    }
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(200)
    expect(chunkText(text, opts)).toEqual(chunks) // deterministic
  })

  it('overlaps consecutive chunks by whole sentences within the overlap budget', () => {
    const chunks = chunkText(prose(60), opts)
    for (let i = 1; i < chunks.length; i++) {
      const overlap = chunks[i - 1].charEnd - chunks[i].charStart
      expect(overlap).toBeGreaterThan(0)
      expect(overlap).toBeLessThanOrEqual(opts.overlapChars)
    }
  })

  it('uses no overlap when overlapChars is 0, and tiles the text', () => {
    const text = prose(60)
    const chunks = chunkText(text, { targetChars: 200, overlapChars: 0 })
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].charStart).toBeGreaterThanOrEqual(chunks[i - 1].charEnd)
    }
    expectFullCoverage(text, chunks)
  })

  it('does not lose content on prose with paragraphs and sentences', () => {
    const text = [prose(20), prose(3), prose(35)].join('\n\n')
    expectFullCoverage(text, chunkText(text, opts))
  })

  it('prefers paragraph boundaries', () => {
    const p1 = 'A'.repeat(90) + '.'
    const p2 = 'B'.repeat(90) + '.'
    const chunks = chunkText(`${p1}\n\n${p2}`, {
      targetChars: 100,
      overlapChars: 10,
    })
    expect(chunks.map((c) => c.text)).toEqual([p1, p2])
  })

  it('splits an over-long paragraph on sentence boundaries', () => {
    const text = prose(30) // one paragraph, far longer than the target
    const chunks = chunkText(text, opts)
    for (const c of chunks) {
      expect(c.text.startsWith('Sentence')).toBe(true)
      expect(c.text.endsWith('.')).toBe(true)
    }
  })

  it('handles a huge unbroken run with no spaces or punctuation', () => {
    const text = 'x'.repeat(1000)
    const chunks = chunkText(text, opts)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(200)
    expectFullCoverage(text, chunks)
  })

  it('handles a very long sentence made of words', () => {
    const text = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ')
    const chunks = chunkText(text, opts)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(200)
    expectFullCoverage(text, chunks)
    // Cuts fall on whitespace, so words are never split.
    const words = new Set(text.split(' '))
    for (const c of chunks) {
      for (const w of c.text.split(/\s+/)) expect(words.has(w)).toBe(true)
    }
  })

  it('handles multi-byte characters without losing text', () => {
    const text = Array.from(
      { length: 80 },
      () => 'Zażółć gęślą jaźń 你好世界。',
    ).join(' ')
    expectFullCoverage(text, chunkText(text, opts))
  })

  it('reconstructs the full text from non-overlapping chunk parts', () => {
    const text = prose(50)
    const chunks = chunkText(text, opts)
    let rebuilt = ''
    let end = 0
    for (const c of chunks) {
      const from = Math.max(c.charStart, end)
      rebuilt += text.slice(from, c.charEnd)
      end = c.charEnd
    }
    expect(strip(rebuilt)).toBe(strip(text))
  })

  it('rejects invalid options', () => {
    expect(() => chunkText('x', { targetChars: 0, overlapChars: 0 })).toThrow(
      RangeError,
    )
    expect(() => chunkText('x', { targetChars: 10, overlapChars: 10 })).toThrow(
      RangeError,
    )
    expect(() => chunkText('x', { targetChars: 10, overlapChars: -1 })).toThrow(
      RangeError,
    )
    expect(() => chunkText('x', { targetChars: 1.5, overlapChars: 0 })).toThrow(
      RangeError,
    )
  })
})

describe('chunkSections', () => {
  const doc = normalizeDocument({
    pageCount: 2,
    pages: [
      {
        pageNumber: 1,
        text: `Abstract\n${prose(2)}\n\nIntroduction\n${prose(30)}`,
      },
      { pageNumber: 2, text: `${prose(10)}\n\nConclusion\nWe conclude.` },
    ],
  })
  const sections = detectSections(doc)
  const chunks = chunkSections(doc, sections, opts)

  it('never crosses section boundaries', () => {
    for (const c of chunks) {
      const section = sections[c.sectionPosition]
      expect(c.text).toBe(section.text.slice(c.charStart, c.charEnd))
    }
  })

  it('numbers chunks 0..n-1 in document order', () => {
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i))
    const positions = chunks.map((c) => c.sectionPosition)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('preserves all section text', () => {
    for (const section of sections) {
      expectFullCoverage(
        section.text,
        chunks.filter((c) => c.sectionPosition === section.position),
      )
    }
  })

  it('assigns page ranges', () => {
    const conclusion = chunks.find((c) => c.text === 'We conclude.')
    expect(conclusion).toMatchObject({ pageStart: 2, pageEnd: 2 })
    const intro = chunks.filter((c) => c.sectionPosition === 1)
    expect(intro[0].pageStart).toBe(1)
    expect(intro.at(-1)?.pageEnd).toBe(2)
  })

  it('produces no chunks for empty sections', () => {
    const emptyDoc = normalizeDocument({
      pageCount: 1,
      pages: [{ pageNumber: 1, text: 'Abstract\nIntroduction\nBody.' }],
    })
    const secs = detectSections(emptyDoc)
    const out = chunkSections(emptyDoc, secs, opts)
    expect(out.map((c) => c.text)).toEqual(['Body.'])
  })
})
