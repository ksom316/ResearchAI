import { createServerFn } from '@tanstack/react-start'
import { embedSearchQuery } from '#/features/search/query-embedder.server'
import { createSupabaseSearchDb } from '#/features/search/search-db'
import { runSemanticSearch } from '#/features/search/search-service'
import {
  createServerLlm,
  isServerDevelopment,
} from '#/features/chat/llm.server'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { createBestEffortServerUsageRecorder } from '#/lib/usage/recorder.server'
import { createServerUsageAllowanceChecker } from '#/lib/usage/allowance.server'
import { createMeteredLlm } from '#/lib/usage/metered-llm'
import { generateWriterDraft } from './generation-service'
import type { WriterEvidenceResult, WriterGenerationResult } from './types'
import { createSupabaseWriterDb } from './writer-db.server'
import { loadWriterReferenceMetadata } from './writer-reference-db.server'
import { prepareWriterEvidence } from './writer-service'
import { writerRequestSchema } from './schemas'
import { resolveWriterProvenance } from './provenance'
import type { WriterProvenanceResult } from './provenance'
import { requireProjectEditor } from '#/lib/projects/authorization.server'

/** Authenticated server boundary for deterministic Writer evidence preparation. */
export const prepareWriterEvidenceFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<WriterEvidenceResult> => {
    const supabase = createSupabaseServerClient()
    const actorUserId = (await supabase.auth.getUser()).data.user?.id ?? null
    const validatedRequest = writerRequestSchema.safeParse(data)
    const projectId = validatedRequest.success
      ? validatedRequest.data.projectId
      : null
    if (projectId) await requireProjectEditor(supabase, projectId)
    const recordUsage = createBestEffortServerUsageRecorder()
    return prepareWriterEvidence(data, {
      db: createSupabaseWriterDb(supabase),
      semanticSearch: (searchRequest) =>
        runSemanticSearch(searchRequest, {
          db: createSupabaseSearchDb(supabase),
          embedQuery: (query) =>
            actorUserId
              ? embedSearchQuery(query, {
                  actorUserId,
                  projectId,
                  feature: 'academic_writer',
                  recordUsage,
                })
              : embedSearchQuery(query),
        }),
    })
  })

/** Generates one fail-closed draft from server-prepared evidence. */
export const generateWriterDraftFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<WriterGenerationResult> => {
    const supabase = createSupabaseServerClient()
    const actorUserId = (await supabase.auth.getUser()).data.user?.id ?? null
    const validatedRequest = writerRequestSchema.safeParse(data)
    const projectId = validatedRequest.success
      ? validatedRequest.data.projectId
      : null
    if (projectId) await requireProjectEditor(supabase, projectId)
    const recordUsage = createBestEffortServerUsageRecorder()
    const checkAllowance = createServerUsageAllowanceChecker()
    const evidenceDeps = {
      db: createSupabaseWriterDb(supabase),
      semanticSearch: (searchRequest: unknown) =>
        runSemanticSearch(searchRequest, {
          db: createSupabaseSearchDb(supabase),
          embedQuery: (query) =>
            actorUserId
              ? embedSearchQuery(query, {
                  actorUserId,
                  projectId,
                  feature: 'academic_writer',
                  recordUsage,
                })
              : embedSearchQuery(query),
        }),
    }
    return generateWriterDraft(data, {
      // The request is still raw at this boundary; evidence preparation revalidates it.
      prepareEvidence: (request) =>
        prepareWriterEvidence(request, evidenceDeps),
      getLlm: () =>
        createMeteredLlm(createServerLlm(), {
          actorUserId,
          projectId,
          feature: 'academic_writer',
          recordUsage,
          checkAllowance,
        }),
      loadReferenceMetadata: (paperIds) =>
        loadWriterReferenceMetadata(supabase, paperIds),
      diagnosticsEnabled: isServerDevelopment(),
    })
  })

/** Lazily resolves one citation after rechecking project and paper scope. */
export const getWriterCitationProvenanceFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<WriterProvenanceResult> => {
    const supabase = createSupabaseServerClient()
    const parsed = writerRequestSchema.safeParse(data)
    if (parsed.success)
      await requireProjectEditor(supabase, parsed.data.projectId)
    return resolveWriterProvenance(data, {
      db: createSupabaseWriterDb(supabase),
    })
  })
