import { z } from 'zod'
import { CLAIM_SUPPORT_VALUES } from './types'

export const MAX_CLAIM_CHECK_SUMMARY_CHARS = 300
export const MAX_CLAIM_CHECK_FRAGMENT_CHARS = 160
export const MAX_CLAIM_CHECK_FRAGMENTS = 3
export const MAX_CLAIM_CHECK_RATIONALE_CHARS = 240

const plainText = (maximum: number) => z.string().trim().min(1).max(maximum)

const citationAssessmentSchema = z.strictObject({
  evidence_id: z.string().regex(/^C[1-4]$/),
  support: z.enum(CLAIM_SUPPORT_VALUES),
  rationale: plainText(MAX_CLAIM_CHECK_RATIONALE_CHARS),
})

/** Untrusted provider output. Authorization is validated separately against the packet. */
export const claimCheckModelOutputSchema = z.strictObject({
  overall_support: z.enum(CLAIM_SUPPORT_VALUES),
  summary: plainText(MAX_CLAIM_CHECK_SUMMARY_CHARS),
  unsupported_fragments: z
    .array(plainText(MAX_CLAIM_CHECK_FRAGMENT_CHARS))
    .max(MAX_CLAIM_CHECK_FRAGMENTS),
  citation_assessments: z.array(citationAssessmentSchema).min(1).max(4),
})

export type ClaimCheckModelOutput = z.infer<typeof claimCheckModelOutputSchema>

const supportEnum = [...CLAIM_SUPPORT_VALUES]

export const CLAIM_CHECK_JSON_SCHEMA = {
  name: 'claim_evidence_support_assessment',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'overall_support',
      'summary',
      'unsupported_fragments',
      'citation_assessments',
    ],
    properties: {
      overall_support: { type: 'string', enum: supportEnum },
      summary: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_CLAIM_CHECK_SUMMARY_CHARS,
      },
      unsupported_fragments: {
        type: 'array',
        maxItems: MAX_CLAIM_CHECK_FRAGMENTS,
        items: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_CLAIM_CHECK_FRAGMENT_CHARS,
        },
      },
      citation_assessments: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['evidence_id', 'support', 'rationale'],
          properties: {
            evidence_id: { type: 'string', pattern: '^C[1-4]$' },
            support: { type: 'string', enum: supportEnum },
            rationale: {
              type: 'string',
              minLength: 1,
              maxLength: MAX_CLAIM_CHECK_RATIONALE_CHARS,
            },
          },
        },
      },
    },
  },
} as const
