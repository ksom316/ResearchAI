import { describe, expect, it } from 'vitest'
import { contentHash, documentInputWithHash } from './hash'
import {
  INPUT_PROFILE_CTX_V1,
  MAX_HEADER_VALUE_CHARS,
  buildDocumentInput,
} from './input'

const fields = {
  paperTitle: 'BERT: Pre-training of Deep Bidirectional Transformers',
  sectionTitle: '3 BERT',
  text: 'We introduce BERT.',
}

describe('ctx-v1 embedding input', () => {
  it('is named ctx-v1 (the profile id seeded in the database)', () => {
    expect(INPUT_PROFILE_CTX_V1).toBe('ctx-v1')
  })

  it('uses the exact documented template', () => {
    expect(buildDocumentInput(fields)).toBe(
      'Title: BERT: Pre-training of Deep Bidirectional Transformers\nSection: 3 BERT\n\nWe introduce BERT.',
    )
  })

  it('is deterministic', () => {
    expect(buildDocumentInput(fields)).toBe(buildDocumentInput({ ...fields }))
  })

  it('leaves the chunk text exactly as stored (no trimming or rewriting)', () => {
    const text =
      '  Indented first line.\n\nSecond paragraph with  double  spaces.\n'
    const input = buildDocumentInput({ ...fields, text })
    expect(input.endsWith(`\n\n${text}`)).toBe(true)
  })

  it.each([null, undefined, '', '   ', '\n\t'])(
    'drops the Section line when the section title is %j',
    (sectionTitle) => {
      expect(buildDocumentInput({ ...fields, sectionTitle })).toBe(
        'Title: BERT: Pre-training of Deep Bidirectional Transformers\n\nWe introduce BERT.',
      )
    },
  )

  it('drops the Title line when the paper title is blank', () => {
    expect(buildDocumentInput({ ...fields, paperTitle: '  ' })).toBe(
      'Section: 3 BERT\n\nWe introduce BERT.',
    )
  })

  it('uses the bare text when both titles are blank', () => {
    expect(
      buildDocumentInput({
        paperTitle: null,
        sectionTitle: '',
        text: 'Just text.',
      }),
    ).toBe('Just text.')
  })

  it('collapses whitespace and newlines inside titles', () => {
    expect(
      buildDocumentInput({
        ...fields,
        paperTitle: '  A   Long\nTitle\t Here ',
        sectionTitle: '2\n Related   Work',
      }),
    ).toBe(
      'Title: A Long Title Here\nSection: 2 Related Work\n\nWe introduce BERT.',
    )
  })

  it('caps very long titles', () => {
    const input = buildDocumentInput({
      ...fields,
      paperTitle: 'x'.repeat(2000),
    })
    const titleLine = input.split('\n')[0]
    expect(titleLine.length).toBeLessThanOrEqual(
      'Title: '.length + MAX_HEADER_VALUE_CHARS + 1,
    )
    expect(titleLine.endsWith('…')).toBe(true)
  })

  it('rejects empty or whitespace-only chunk text', () => {
    expect(() => buildDocumentInput({ ...fields, text: '' })).toThrow(
      RangeError,
    )
    expect(() => buildDocumentInput({ ...fields, text: ' \n ' })).toThrow(
      RangeError,
    )
  })

  it('accepts only the three documented fields, so IDs and paths cannot leak in', () => {
    const input = buildDocumentInput({
      ...fields,
      // Extra properties (as a caller might pass a whole database row) are ignored.
      ...({
        id: 'chunk-uuid-1234',
        user_id: 'user-uuid-5678',
        storage_path: 'user/paper/file.pdf',
        created_at: '2026-01-01T00:00:00Z',
      } as object),
    })
    for (const forbidden of [
      'chunk-uuid',
      'user-uuid',
      'file.pdf',
      '2026-01-01',
    ]) {
      expect(input).not.toContain(forbidden)
    }
  })
})

describe('content hash', () => {
  it('is the SHA-256 hex of the exact input, pinned for a known ctx-v1 string', () => {
    expect(contentHash(buildDocumentInput(fields))).toBe(
      '96e73e44a4f72f1fb78044c861047e03338af081ebea200c04c7525e3b17d39c',
    )
  })

  it('matches the database format (64 lowercase hex characters)', () => {
    expect(contentHash('anything')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is stable across calls and changes when any part of the input changes', () => {
    const base = documentInputWithHash(fields)
    expect(documentInputWithHash({ ...fields }).hash).toBe(base.hash)
    for (const changed of [
      { ...fields, paperTitle: 'Other title' },
      { ...fields, sectionTitle: '4 Experiments' },
      { ...fields, text: 'We introduce BERT!' },
    ]) {
      expect(documentInputWithHash(changed).hash).not.toBe(base.hash)
    }
  })

  it('hashes the input, not the raw chunk text alone', () => {
    const { input, hash } = documentInputWithHash(fields)
    expect(hash).toBe(contentHash(input))
    expect(hash).not.toBe(contentHash(fields.text))
  })

  it('hashes UTF-8 bytes (non-ASCII text is stable)', () => {
    const a = contentHash('Zażółć gęślą jaźń 你好')
    expect(a).toBe(contentHash('Zażółć gęślą jaźń 你好'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})
