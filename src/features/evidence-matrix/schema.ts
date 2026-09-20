import { z } from 'zod'
import { FIELD_KEYS } from './fields'

export const MAX_ITEMS_PER_FIELD = 3
export const MAX_ITEM_CHARS = 500
/**
 * 3 items x 5 ids = 15 sources per field, well inside store_extraction_field's cap of 60
 * (0009 still allows up to 12 items per field; the application contract is tighter).
 * The JSON Schema deliberately has no minItems on "items": not_reported must be [] in
 * the same object, and a per-state rule is expressed only in Zod.
 */
export const MAX_EVIDENCE_IDS_PER_ITEM = 5

/**
 * What the PROVIDER is shown. Deliberately stricter than the defensive runtime limits
 * above: a model that obeys them writes far fewer tokens (the schema-permitted worst case
 * then fits inside the output budget), while the parser still accepts anything up to the
 * runtime limits. Zod stays the authority; nothing here loosens it.
 */
export const PROVIDER_MAX_ITEM_CHARS = 240
export const PROVIDER_MAX_EVIDENCE_IDS = 3

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
    { message: 'extracted needs 1-3 items; not_reported needs none' },
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
          text: { type: 'string', minLength: 1, maxLength: PROVIDER_MAX_ITEM_CHARS },
          evidence_ids: {
            type: 'array',
            minItems: 1,
            maxItems: PROVIDER_MAX_EVIDENCE_IDS,
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
