import type { ProcessingErrorCode, ProcessingFailure } from './types'

/** Thrown by extractor adapters (and the pipeline) with a user-safe message. */
export class ProcessingError extends Error {
  readonly code: ProcessingErrorCode

  constructor(code: ProcessingErrorCode, message: string) {
    super(message)
    this.name = 'ProcessingError'
    this.code = code
  }
}

export const FAILURE_MESSAGES: Record<ProcessingErrorCode, string> = {
  invalid_pdf: 'The file could not be read as a PDF.',
  encrypted_pdf: 'The PDF is password-protected.',
  no_extractable_text:
    'No text could be extracted. The PDF may be a scan of images.',
  extraction_failed: 'Text extraction failed unexpectedly.',
  timeout: 'Processing took too long and was stopped.',
  storage_error: 'The PDF file could not be downloaded from storage.',
  persistence_error: 'The extracted text could not be saved.',
}

/**
 * Converts anything thrown during processing into a failure that is safe to
 * store and display. Unknown errors never leak their raw message.
 */
export function toProcessingFailure(error: unknown): ProcessingFailure {
  if (error instanceof ProcessingError) {
    return { code: error.code, message: error.message }
  }
  return {
    code: 'extraction_failed',
    message: FAILURE_MESSAGES.extraction_failed,
  }
}
