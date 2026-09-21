import {
  boundedWriterText,
  sanitizeWriterLine,
  sanitizeWriterText,
} from '#/features/writer/sanitize'

const CLAIM_CHECK_EVIDENCE_ID = /\bC\s*\d{1,3}\b/giu
const CLAIM_CHECK_DELIMITER =
  /\b(?:BEGIN|END)\s+(?:CLAIM|CLAIM CHECK(?:ER)? EVIDENCE)\b/giu

export function sanitizeClaimCheckText(text: string): string {
  return sanitizeWriterText(text)
    .replace(CLAIM_CHECK_EVIDENCE_ID, '[claim check evidence removed]')
    .replace(CLAIM_CHECK_DELIMITER, '[claim check delimiter removed]')
}

export function sanitizeClaimCheckLine(text: string, maxChars: number): string {
  return sanitizeWriterLine(sanitizeClaimCheckText(text), maxChars)
}

export function boundedClaimCheckText(text: string, maxChars: number): string {
  return boundedWriterText(sanitizeClaimCheckText(text), maxChars)
}
