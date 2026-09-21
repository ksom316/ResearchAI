import { createServerFn } from '@tanstack/react-start'
import { embedSearchQuery } from '#/features/search/query-embedder.server'
import { createSupabaseSearchDb } from '#/features/search/search-db'
import { runSemanticSearch } from '#/features/search/search-service'
import { createServerLlm } from '#/features/chat/llm.server'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { generateWriterDraft } from './generation-service'
import type { WriterEvidenceResult, WriterGenerationResult } from './types'
import { createSupabaseWriterDb } from './writer-db.server'
import { prepareWriterEvidence } from './writer-service'

/** Authenticated server boundary for deterministic Writer evidence preparation. */
export const prepareWriterEvidenceFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<WriterEvidenceResult> => {
    const supabase = createSupabaseServerClient()
    return prepareWriterEvidence(data, {
      db: createSupabaseWriterDb(supabase),
      semanticSearch: (request) =>
        runSemanticSearch(request, {
          db: createSupabaseSearchDb(supabase),
          embedQuery: (query) => embedSearchQuery(query),
        }),
    })
  })

/** Generates one fail-closed draft from server-prepared evidence. */
export const generateWriterDraftFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<WriterGenerationResult> => {
    const supabase = createSupabaseServerClient()
    const evidenceDeps = {
      db: createSupabaseWriterDb(supabase),
      semanticSearch: (request: unknown) =>
        runSemanticSearch(request, {
          db: createSupabaseSearchDb(supabase),
          embedQuery: (query) => embedSearchQuery(query),
        }),
    }
    return generateWriterDraft(data, {
      prepareEvidence: (request) =>
        prepareWriterEvidence(request, evidenceDeps),
      getLlm: () => createServerLlm(),
    })
  })
