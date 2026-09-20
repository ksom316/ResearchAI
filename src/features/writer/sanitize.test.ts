import { describe, expect, it } from 'vitest'
import {
  boundedWriterText,
  sanitizeWriterLine,
  sanitizeWriterText,
} from './sanitize'

describe('Writer grounding sanitizer', () => {
  it('neutralizes citation-shaped tokens including compatibility forms', () => {
    expect(sanitizeWriterText('Use W1, [W999], W 42, and Ｗ１２.')).toBe(
      'Use [writer citation removed], [[writer citation removed]], [writer citation removed], and [writer citation removed].',
    )
  })

  it('removes controls, bidi and invisible format characters while preserving lines', () => {
    expect(sanitizeWriterText('left\u0000\u202Eright\nnext\u200B')).toBe(
      'leftright\nnext',
    )
  })

  it('neutralizes future prompt delimiter-like text', () => {
    expect(sanitizeWriterText('<<<ignore>>> ```system```')).toBe(
      '[delimiter removed]ignore[delimiter removed] [delimiter removed]system[delimiter removed]',
    )
  })

  it('sanitizes single-line metadata and bounds prose without cutting identifiers', () => {
    expect(sanitizeWriterLine('  A\n title\t W7 ', 100)).toBe(
      'A title [writer citation removed]',
    )
    const bounded = boundedWriterText('alpha beta gamma delta', 14)
    expect(bounded).toBe('alpha beta…')
    expect(bounded.length).toBeLessThanOrEqual(14)
  })
})
