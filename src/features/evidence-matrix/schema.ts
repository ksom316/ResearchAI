import { z } from 'zod'
import { FIELD_KEYS } from './fields'

export const MAX_ITEMS_PER_FIELD = 12
export const MAX_ITEM_CHARS = 500
/** 12 items x 5 = 60, the per-field source cap of store_extraction_field. */
export const MAX_EVIDENCE_IDS_PER_ITEM = 5

const itemSchema = z.strictObject({
  text: z.string().trim().min(1).max(MAX_ITEM_CHARS),
  evidence_ids: z
    .array(z.string().regex(/^E\d{1,3}$/))
    .min(1)
    .max(MAX_EVIDENCE_IDS_PER_ITEM),
})

const fieldSchema = z
  .strictObject({
    state: z.enum(['extracted', 'not_reported']),
    items: z.array(itemSchema).max(MAX_ITEMS_PER_FIELD),
  })
  .refine(
    (f) => (f.state === 'extracted' ? f.items.length >= 1 : f.items.length === 0),
    { message: 'extracted needs 1-12 items; not_reported needs none' },
  )

/** Untrusted model output: passing this does NOT make citations valid. */
export const extractionOutputSchema = z.strictObject({
  fields: z.strictObject({
    objective: fieldSchema,
    methodology: fieldSchema,
    dataset: fieldSchema,
    findings: fieldSchema,
    limitations: fieldSchema,
    future_work: fieldSchema,
    concepts: fieldSchema,
  }),
})
export type ExtractionOutput = z.infer<typeof extractionOutputSchema>

const fieldJson = {
  type: 'object',
  additionalProperties: false,
  required: ['state', 'items'],
  properties: {
    state: { type: 'string', enum: ['extracted', 'not_reported'] },
    items: {
      type: 'array',
      maxItems: MAX_ITEMS_PER_FIELD,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'evidence_ids'],
        properties: {
          text: { type: 'string', minLength: 1, maxLength: MAX_ITEM_CHARS },
          evidence_ids: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_EVIDENCE_IDS_PER_ITEM,
            items: { type: 'string', pattern: '^E[0-9]{1,3}$' },
          },
        },
      },
    },
  },
}

/** Provider-facing JSON Schema; zod remains the authority. */
export const EXTRACTION_JSON_SCHEMA = {
  name: 'evidence_matrix_extraction',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['fields'],
    properties: {
      fields: {
        type: 'object',
        additionalProperties: false,
        required: [...FIELD_KEYS],
        properties: Object.fromEntries(FIELD_KEYS.map((k) => [k, fieldJson])),
      },
    },
  },
}
