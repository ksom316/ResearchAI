import { createServerFn } from '@tanstack/react-start'
import {
  createServerLlm,
  isServerDevelopment,
} from '#/features/chat/llm.server'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { createSupabaseWriterDb } from '#/features/writer/writer-db.server'
import { assessClaimSupport } from './assessment-service'
import type { ClaimCheckResult } from './types'

/** Authenticated server boundary; browser input is only the strict 7B.2 request. */
export const checkClaimSupportFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<ClaimCheckResult> => {
    const supabase = createSupabaseServerClient()
    return assessClaimSupport(data, {
      db: createSupabaseWriterDb(supabase),
      getLlm: () => createServerLlm(),
      diagnosticsEnabled: isServerDevelopment(),
    })
  })
