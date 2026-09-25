import { createServerFn } from '@tanstack/react-start'
import { embedSearchQuery } from '#/features/search/query-embedder.server'
import { createSupabaseSearchDb } from '#/features/search/search-db'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { createBestEffortServerUsageRecorder } from '#/lib/usage/recorder.server'
import { createServerUsageAllowanceChecker } from '#/lib/usage/allowance.server'
import { createMeteredLlm } from '#/lib/usage/metered-llm'
import { requireProjectEditor } from '#/lib/projects/authorization.server'
import { runGroundedAnswer } from './answer-service'
import { createServerLlm } from './llm.server'
import { logResearchChatDiagnostic } from './diagnostics'
import { askRequestSchema } from './schemas'
import type { AskOutcome } from './types'

/**
 * Grounded, single-turn, stateless research answer. The client sends only
 * { question, scope }; validation happens in the service and is answered as a result
 * union. Uses the request-scoped cookie client (never service role) and reuses the
 * Phase 4 retrieval service in-process.
 */
export const askResearchFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<AskOutcome> => {
    const supabase = createSupabaseServerClient()
    const actorUserId = (await supabase.auth.getUser()).data.user?.id ?? null
    const parsed = askRequestSchema.safeParse(data)
    const projectId =
      parsed.success && parsed.data.scope.type === 'project'
        ? parsed.data.scope.projectId
        : null
    if (projectId) await requireProjectEditor(supabase, projectId)
    const recordUsage = createBestEffortServerUsageRecorder()
    const checkAllowance = createServerUsageAllowanceChecker()
    return runGroundedAnswer(data, {
      search: {
        db: createSupabaseSearchDb(supabase),
        embedQuery: (query) =>
          actorUserId
            ? embedSearchQuery(query, {
                actorUserId,
                projectId,
                feature: 'research_chat',
                recordUsage,
              })
            : embedSearchQuery(query),
      },
      getLlm: () =>
        createMeteredLlm(createServerLlm(), {
          actorUserId,
          projectId,
          feature: 'research_chat',
          recordUsage,
          checkAllowance,
        }),
      diagnostic: logResearchChatDiagnostic,
    })
  })
