import { z } from 'zod'

export const MAX_WRITER_PARAGRAPHS = 4
export const MAX_WRITER_UNITS_PER_PARAGRAPH = 3
export const MAX_WRITER_UNITS = 10
export const MAX_WRITER_UNIT_CHARS = 450
export const MAX_WRITER_UNIT_CITATIONS = 4
export const MAX_WRITER_GENERATED_CHARS = 4_000

const citationIdSchema = z.string().regex(/^W\d{1,3}$/)

const unitSchema = z.strictObject({
  text: z.string().trim().min(1).max(MAX_WRITER_UNIT_CHARS),
  citation_ids: z.array(citationIdSchema).min(1).max(MAX_WRITER_UNIT_CITATIONS),
})

const paragraphSchema = z.strictObject({
  units: z.array(unitSchema).min(1).max(MAX_WRITER_UNITS_PER_PARAGRAPH),
})

const generatedSchema = z.strictObject({
  status: z.literal('generated'),
  paragraphs: z.array(paragraphSchema).min(1).max(MAX_WRITER_PARAGRAPHS),
})

const insufficientSchema = z.strictObject({
  status: z.literal('insufficient_evidence'),
  paragraphs: z.array(paragraphSchema).length(0),
})

/** Untrusted model output. Passing this schema does not authorize any citation id. */
export const writerModelOutputSchema = z
  .discriminatedUnion('status', [generatedSchema, insufficientSchema])
  .superRefine((value, ctx) => {
    if (value.status !== 'generated') return
    const units = value.paragraphs.flatMap((paragraph) => paragraph.units)
    if (units.length > MAX_WRITER_UNITS) {
      ctx.addIssue({
        code: 'custom',
        path: ['paragraphs'],
        message: 'unit_limit',
      })
    }
    if (
      units.reduce((total, unit) => total + unit.text.length, 0) >
      MAX_WRITER_GENERATED_CHARS
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['paragraphs'],
        message: 'generated_text_limit',
      })
    }
  })

export type WriterModelOutput = z.infer<typeof writerModelOutputSchema>

const providerUnitSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'citation_ids'],
  properties: {
    text: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_WRITER_UNIT_CHARS,
    },
    citation_ids: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_WRITER_UNIT_CITATIONS,
      items: { type: 'string', pattern: '^W[0-9]{1,3}$' },
    },
  },
}

/** Provider-facing JSON Schema. Zod and citation validation remain authoritative. */
export const WRITER_DRAFT_JSON_SCHEMA = {
  name: 'citation_grounded_writer_draft',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'paragraphs'],
    properties: {
      status: {
        type: 'string',
        enum: ['generated', 'insufficient_evidence'],
      },
      paragraphs: {
        type: 'array',
        maxItems: MAX_WRITER_PARAGRAPHS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['units'],
          properties: {
            units: {
              type: 'array',
              minItems: 1,
              maxItems: MAX_WRITER_UNITS_PER_PARAGRAPH,
              items: providerUnitSchema,
            },
          },
        },
      },
    },
  },
} as const
