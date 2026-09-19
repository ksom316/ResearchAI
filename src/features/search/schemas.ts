import { z } from 'zod'
import { normalizeQuery } from './normalize'

export const MAX_QUERY_LENGTH = 1000
export const MIN_QUERY_LENGTH = 2
export const MAX_SCOPE_PAPERS = 50
export const DEFAULT_LIMIT = 10
export const MAX_LIMIT = 50

const uuid = z.uuid()

export const scopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('library') }),
  z.object({ type: z.literal('project'), projectId: uuid }),
  z.object({
    type: z.literal('papers'),
    paperIds: z
      .array(uuid)
      .min(1)
      .max(MAX_SCOPE_PAPERS)
      .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]),
  }),
])

/** Raw question -> normalized query (shared by search and chat). */
export const queryField = z
  .string()
  .max(20_000)
  .transform(normalizeQuery)
  .pipe(
    z
      .string()
      .min(MIN_QUERY_LENGTH)
      .max(MAX_QUERY_LENGTH)
      .regex(/[\p{L}\p{N}]/u),
  )

/**
 * Raw input -> SearchRequest. Out-of-range limit / minSimilarity are REJECTED (not
 * clamped) so a caller learns about a mistake; the database clamps only as a backstop.
 */
export const searchRequestSchema = z.object({
  query: queryField,
  scope: scopeSchema,
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  minSimilarity: z
    .number()
    .min(-1)
    .max(1)
    .nullish()
    .transform((value) => value ?? null),
  includeReferences: z.boolean().default(false),
})
