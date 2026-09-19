import { z } from 'zod'
import { queryField, scopeSchema } from '#/features/search/schemas'

/**
 * The ONLY things a client may send. Retrieval limit, similarity, references,
 * evidence, model and prompts are all server-controlled.
 */
export const askRequestSchema = z.object({
  question: queryField,
  scope: scopeSchema,
})

export const MAX_SEGMENTS = 12
export const MAX_SEGMENT_CHARS = 1500
export const MAX_ANSWER_CHARS = 6000
export const MAX_CITATIONS_PER_SEGMENT = 8
export const MAX_EXPLANATION_CHARS = 300

const segmentSchema = z.object({
  text: z.string().trim().min(1).max(MAX_SEGMENT_CHARS),
  citations: z
    .array(z.string().regex(/^S\d{1,3}$/))
    .max(MAX_CITATIONS_PER_SEGMENT),
})

/** Untrusted model output. Passing this does NOT make citations valid. */
export const modelAnswerSchema = z
  .object({
    status: z.enum(['answered', 'insufficient_evidence', 'out_of_scope']),
    segments: z.array(segmentSchema).max(MAX_SEGMENTS),
    /**
     * The ONLY free text allowed for insufficient_evidence / out_of_scope: a short
     * note that the supplied evidence is insufficient or unrelated. Ignored when answered.
     */
    explanation: z
      .string()
      .trim()
      .max(MAX_EXPLANATION_CHARS)
      .nullish()
      .transform((v) => (v ? v : null)),
    limitations: z
      .string()
      .trim()
      .max(600)
      .nullish()
      .transform((v) => (v ? v : null)),
    followUps: z
      .array(z.string().trim().min(1).max(200))
      .max(3)
      .nullish()
      .transform((v) => v ?? []),
  })
  .refine(
    (a) =>
      a.segments.reduce((sum, s) => sum + s.text.length, 0) <= MAX_ANSWER_CHARS,
  )

export type ModelAnswer = z.infer<typeof modelAnswerSchema>

/**
 * The same shape as a JSON schema for the provider. Size limits are left to zod (some
 * providers reject them in strict mode); every property is required, as strict mode needs.
 */
export const ANSWER_JSON_SCHEMA = {
  name: 'grounded_answer',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'segments', 'explanation', 'limitations', 'followUps'],
    properties: {
      status: {
        type: 'string',
        enum: ['answered', 'insufficient_evidence', 'out_of_scope'],
      },
      segments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'citations'],
          properties: {
            text: { type: 'string' },
            citations: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      explanation: { type: ['string', 'null'] },
      limitations: { type: ['string', 'null'] },
      followUps: { type: 'array', items: { type: 'string' } },
    },
  },
} as const
