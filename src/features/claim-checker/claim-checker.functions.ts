import { createServerFn } from '@tanstack/react-start'
import {
  createServerLlm,
  isServerDevelopment,
} from '#/features/chat/llm.server'
import { createSupabaseServerClient } from '#/lib/supabase/supabase.server'
import { createSupabaseWriterDb } from '#/features/writer/writer-db.server'
import { createBestEffortServerUsageRecorder } from '#/lib/usage/recorder.server'
import { createServerUsageAllowanceChecker } from '#/lib/usage/allowance.server'
import { createMeteredLlm } from '#/lib/usage/metered-llm'
import { assessClaimSupport } from './assessment-service'
import { claimCheckRequestSchema } from './schemas'
import type { ClaimCheckResult } from './types'
import { requireProjectEditor } from '#/lib/projects/authorization.server'

/** Authenticated server boundary; browser input is only the strict 7B.2 request. */
export const checkClaimSupportFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data)
  .handler(async ({ data }): Promise<ClaimCheckResult> => {
    const supabase = createSupabaseServerClient()
    const actorUserId = (await supabase.auth.getUser()).data.user?.id ?? null
    const request = claimCheckRequestSchema.safeParse(data)
    const projectId = request.success ? request.data.projectId : null
    if (projectId) await requireProjectEditor(supabase, projectId)
    const recordUsage = createBestEffortServerUsageRecorder()
    const checkAllowance = createServerUsageAllowanceChecker()
    return assessClaimSupport(data, {
      db: createSupabaseWriterDb(supabase),
      getLlm: () =>
        createMeteredLlm(createServerLlm(), {
          actorUserId,
          projectId,
          feature: 'claim_checker',
          recordUsage,
          checkAllowance,
        }),
      diagnosticsEnabled: isServerDevelopment(),
    })
  })
