import { z } from 'zod'
import { sanitizeWriterText } from './sanitize'

export const MAX_WRITER_FOCUS_CHARS = 500
export const MAX_WRITER_PAPERS = 5

const projectId = z.uuid().transform((value) => value.toLowerCase())
const focus = z
  .string()
  .max(5_000)
  .transform((value) => sanitizeWriterText(value).replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(2)
      .max(MAX_WRITER_FOCUS_CHARS)
      .regex(/[\p{L}\p{N}]/u),
  )

const paperIds = z
  .array(z.uuid().transform((value) => value.toLowerCase()))
  .min(1)
  .max(MAX_WRITER_PAPERS)
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Paper ids must be unique' })
    }
  })

const literature = z.strictObject({
  projectId,
  mode: z.literal('literature_synthesis'),
  focus,
})

const comparison = z.strictObject({
  projectId,
  mode: z.literal('compare_studies'),
  paperIds: paperIds.min(2),
})

const optionalSelection = (
  mode:
    'methodology_summary' | 'findings_synthesis' | 'limitations_future_work',
) =>
  z.strictObject({
    projectId,
    mode: z.literal(mode),
    paperIds: paperIds.optional(),
  })

export const writerRequestSchema = z.discriminatedUnion('mode', [
  literature,
  comparison,
  optionalSelection('methodology_summary'),
  optionalSelection('findings_synthesis'),
  optionalSelection('limitations_future_work'),
])
