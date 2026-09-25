import type { ChatErrorCode } from '../types'

export const SUGGESTIONS = [
  'What are the main findings across these papers?',
  'What methodologies are used?',
  'What limitations do the studies report?',
  'Where do the papers agree or disagree?',
] as const

export const NO_EVIDENCE_MESSAGE =
  'This project does not have searchable evidence yet. Add papers and wait until they finish processing and indexing, then ask again.'

/** Friendly copy per stable error code. Raw errors are never shown. */
export const ERROR_MESSAGES: Record<ChatErrorCode, string> = {
  invalid_request: 'That question could not be used. Try rephrasing it.',
  unauthenticated: 'Your session has expired. Sign in again to continue.',
  scope_not_found:
    'This project could not be found or you no longer have access to it.',
  search_busy: 'Search is busy right now. Wait a minute and ask again.',
  search_unavailable:
    'Searching your research is unavailable at the moment. Please try again later.',
  answer_busy:
    'The answer service is busy right now. Wait a moment and ask again.',
  answer_timeout:
    'The answer took too long. Please try again, or ask a narrower question.',
  usage_exhausted:
    'Your monthly AI usage allowance has been reached. It resets at the start of next month.',
  answer_unavailable:
    'An answer could not be produced from your papers this time. Please try again.',
}

export const FALLBACK_ERROR_MESSAGE = ERROR_MESSAGES.answer_unavailable
