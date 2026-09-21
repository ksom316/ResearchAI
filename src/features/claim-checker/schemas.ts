import { z } from 'zod'
import { evidenceIdentity } from '#/features/writer/evidence'
import { writerEvidenceLocatorSchema } from '#/features/writer/schemas'
import { sanitizeClaimCheckText } from './sanitize'

export const MAX_CLAIM_CHECK_CLAIM_CHARS = 450
export const MAX_CLAIM_CHECK_CITATIONS = 4

const claimText = z
  .string()
  .max(5_000)
  .transform((value) =>
    sanitizeClaimCheckText(value).replace(/\s+/g, ' ').trim(),
  )
  .pipe(z.string().min(1).max(MAX_CLAIM_CHECK_CLAIM_CHARS).regex(/[\p{L}\p{N}]/u))

const citation = z.strictObject({
  citationId: z.string().regex(/^W\d{1,3}$/),
  locator: writerEvidenceLocatorSchema,
})

export const claimCheckRequestSchema = z
  .strictObject({
    projectId: z.uuid().transform((value) => value.toLowerCase()),
    claimId: z.string().regex(/^U(?:10|[1-9])$/),
    claimText,
    citations: z.array(citation).min(1).max(MAX_CLAIM_CHECK_CITATIONS),
  })
  .superRefine((value, context) => {
    const ids = new Set<string>()
    const locators = new Set<string>()
    value.citations.forEach((entry, index) => {
      if (ids.has(entry.citationId)) {
        context.addIssue({
          code: 'custom',
          path: ['citations', index, 'citationId'],
          message: 'duplicate_citation_id',
        })
      }
      ids.add(entry.citationId)
      const identity = evidenceIdentity(entry.locator)
      if (locators.has(identity)) {
        context.addIssue({
          code: 'custom',
          path: ['citations', index, 'locator'],
          message: 'duplicate_locator',
        })
      }
      locators.add(identity)
    })
  })
