import { describe, expect, it } from 'vitest'
import { FAILURE_MESSAGES } from '#/features/processing/errors'
import { STATUS_INFO, describeFailure, isInProgress } from './status'

describe('STATUS_INFO', () => {
  it('uses the agreed plain-language headline for each status', () => {
    expect(STATUS_INFO.uploaded.headline).toBe('Waiting to be processed')
    expect(STATUS_INFO.processing.headline).toBe('Processing document…')
    expect(STATUS_INFO.ready.headline).toBe('Ready for research')
    expect(STATUS_INFO.failed.headline).toBe('Processing failed')
  })

  it('has short badge labels', () => {
    expect(Object.values(STATUS_INFO).map((s) => s.label)).toEqual([
      'Uploaded',
      'Processing',
      'Ready',
      'Failed',
    ])
  })
})

describe('isInProgress', () => {
  it.each([
    ['uploaded', true],
    ['processing', true],
    ['ready', false],
    ['failed', false],
  ] as const)('%s -> %s', (status, expected) => {
    expect(isInProgress(status)).toBe(expected)
  })
})

describe('describeFailure', () => {
  it('explains no_extractable_text as a scanned / image-only PDF', () => {
    const failure = describeFailure(FAILURE_MESSAGES.no_extractable_text)
    expect(failure.kind).toBe('no_extractable_text')
    expect(failure.explanation).toMatch(/scanned or image-only/i)
    expect(failure.explanation).not.toMatch(/ocr/i)
    expect(failure.detail).toBeNull()
  })

  it.each([
    'encrypted_pdf',
    'invalid_pdf',
    'timeout',
    'extraction_failed',
    'storage_error',
    'persistence_error',
  ] as const)('recognizes the stored %s message', (code) => {
    const failure = describeFailure(FAILURE_MESSAGES[code])
    expect(failure.kind).toBe(code)
    expect(failure.explanation.length).toBeGreaterThan(10)
    expect(failure.detail).toBeNull()
  })

  it('recognizes the database-set interrupted message', () => {
    const failure = describeFailure(
      'Processing was interrupted repeatedly and was stopped.',
    )
    expect(failure.kind).toBe('interrupted')
  })

  it('ignores surrounding whitespace', () => {
    expect(describeFailure(`  ${FAILURE_MESSAGES.encrypted_pdf}\n`).kind).toBe(
      'encrypted_pdf',
    )
  })

  it('falls back safely when there is no message', () => {
    for (const value of [null, '', '   ']) {
      const failure = describeFailure(value)
      expect(failure.kind).toBe('unknown')
      expect(failure.detail).toBeNull()
    }
  })

  it('shows an unrecognized message as plain detail text, unchanged', () => {
    const failure = describeFailure('Something odd <b>happened</b>')
    expect(failure.kind).toBe('unknown')
    expect(failure.detail).toBe('Something odd <b>happened</b>')
  })

  it('never suggests re-uploading the same file (duplicate detection would block it)', () => {
    for (const code of Object.keys(
      FAILURE_MESSAGES,
    ) as (keyof typeof FAILURE_MESSAGES)[]) {
      expect(describeFailure(FAILURE_MESSAGES[code]).explanation).not.toMatch(
        /upload it again|re-?upload/i,
      )
    }
  })
})
