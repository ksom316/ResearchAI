import { FAILURE_MESSAGES } from '#/features/processing/errors'
import type { ProcessingErrorCode } from '#/features/processing/types'
import type { PaperStatus } from './types'

/** Short badge label, and the sentence describing what the status means. */
export const STATUS_INFO: Record<
  PaperStatus,
  { label: string; headline: string; description: string }
> = {
  uploaded: {
    label: 'Uploaded',
    headline: 'Waiting to be processed',
    description:
      'The PDF is saved. Its text and structure will be extracted once processing starts.',
  },
  processing: {
    label: 'Processing',
    headline: 'Processing document…',
    description:
      'Extracting text and detecting sections. This page updates automatically.',
  },
  ready: {
    label: 'Ready',
    headline: 'Ready for research',
    description: 'The text has been extracted and the document is organized.',
  },
  failed: {
    label: 'Failed',
    headline: 'Processing failed',
    description: 'The document could not be processed.',
  },
}

/** Statuses that will change without user action, so views may refresh them. */
export function isInProgress(status: PaperStatus): boolean {
  return status === 'uploaded' || status === 'processing'
}

/** Set by the claim function when a job is abandoned repeatedly (see migration 0005). */
const INTERRUPTED_MESSAGE =
  'Processing was interrupted repeatedly and was stopped.'

type FailureKind = ProcessingErrorCode | 'interrupted' | 'unknown'

const EXPLANATIONS: Record<FailureKind, string> = {
  no_extractable_text:
    'No text could be extracted. This PDF may contain scanned or image-only pages, so there is no text layer to read. Try a text-based version of the paper.',
  encrypted_pdf:
    'This PDF is password-protected. Remove the password and add the paper again.',
  invalid_pdf:
    'The file could not be read as a valid PDF. It may be damaged or not a real PDF.',
  timeout: 'The document took too long to process and was stopped.',
  extraction_failed:
    'Something unexpected went wrong while reading this document.',
  storage_error:
    'The PDF could not be retrieved for processing. This is usually temporary.',
  persistence_error:
    'The extracted text could not be saved. This is usually temporary.',
  interrupted:
    'Processing was interrupted several times and was stopped. This is usually temporary.',
  unknown: 'The document could not be processed.',
}

export type FailureDescription = {
  kind: FailureKind
  /** Friendly explanation for the user. */
  explanation: string
  /** The stored safe message, when it adds something beyond the explanation. */
  detail: string | null
}

/**
 * Turns the stored processing_error into a friendly explanation. The stored
 * text comes from a fixed set of safe messages; anything unrecognized is shown
 * as plain text only (never interpreted).
 */
export function describeFailure(
  processingError: string | null,
): FailureDescription {
  const message = processingError?.trim() ?? ''
  if (message === '') {
    return { kind: 'unknown', explanation: EXPLANATIONS.unknown, detail: null }
  }
  if (message === INTERRUPTED_MESSAGE) {
    return {
      kind: 'interrupted',
      explanation: EXPLANATIONS.interrupted,
      detail: null,
    }
  }
  const known = (
    Object.entries(FAILURE_MESSAGES) as [ProcessingErrorCode, string][]
  ).find(([, text]) => text === message)
  if (known) {
    return { kind: known[0], explanation: EXPLANATIONS[known[0]], detail: null }
  }
  return { kind: 'unknown', explanation: EXPLANATIONS.unknown, detail: message }
}
