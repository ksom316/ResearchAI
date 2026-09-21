import { createServerFn } from '@tanstack/react-start'
import { embedSearchQuery } from '#/features/search/query-embedder.server'
import { createSupabaseSearchDb } from '#/features/search/search-db'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { runGroundedAnswer } from './answer-service'
import { createServerLlm } from './llm.server'
import { logResearchChatDiagnostic } from './diagnostics'
import type { AskOutcome } from './types'

/**
 * Grounded, single-turn, stateless research answer. The client sends only
 * { question, scope }; validation happens in the service and is answered as a result
 * union. Uses the request-scoped cookie client (never service role) and reuses the
 * Phase 4 retrieval service in-process.
 */
export const askResearchFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<AskOutcome> =>
    runGroundedAnswer(data, {
      search: {
        db: createSupabaseSearchDb(createSupabaseServerClient()),
        embedQuery: (query) => embedSearchQuery(query),
      },
      getLlm: () => createServerLlm(),
      diagnostic: logResearchChatDiagnostic,
    }),
  )
