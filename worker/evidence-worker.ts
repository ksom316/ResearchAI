import { createServerLlm } from '../src/features/chat/llm.server'
import { createMeteredLlm } from '../src/lib/usage/metered-llm'
import { createSupabaseUsageRecorder } from '../src/lib/usage/recorder.server'
import { createSupabaseUsageAllowanceChecker } from '../src/lib/usage/allowance.server'
import { ConfigError, loadConfig } from './config'
import { describeError } from './diagnostics'
import { createSupabaseExtractionStore } from './evidence/job-store'
import { runNextExtraction } from './evidence/run-extraction'
import { createWorkerClient } from './job-store'
import { abortableSleep, runLoop } from './loop'
import type { LoopMode } from './loop'

/**
 * Local Evidence Matrix worker. Processes ONLY extractions a user requested
 * (request_paper_extraction); it never scans the library.
 *   npm run worker:evidence         keep polling for requests (Ctrl+C to stop)
 *   npm run worker:evidence:once    process one requested extraction and exit
 *   npm run worker:evidence:drain   process everything requested, then exit
 * Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY and LLM_MODEL in
 * .env.worker. One structured LLM call per attempt, at most WORKER_MAX_ATTEMPTS.
 */

const log = (message: string) =>
  console.log(`[${new Date().toISOString()}] ${message}`)

function parseMode(args: string[]): LoopMode {
  if (args.includes('--once')) return 'once'
  if (args.includes('--drain')) return 'drain'
  return 'continuous'
}

async function main() {
  const mode = parseMode(process.argv.slice(2))
  const config = loadConfig()
  // Fail fast on missing LLM configuration instead of failing every paper later.
  const llm = createServerLlm()
  const client = createWorkerClient(config)
  const recordUsage = createSupabaseUsageRecorder(client)
  const checkAllowance = createSupabaseUsageAllowanceChecker(client)
  const store = createSupabaseExtractionStore(client, {
    maxAttempts: config.maxAttempts,
    staleAfterMinutes: config.staleAfterMinutes,
  })

  const controller = new AbortController()
  process.on('SIGINT', () => {
    if (controller.signal.aborted) process.exit(1)
    log('SIGINT received: finishing the current extraction, then stopping')
    controller.abort()
  })
  process.on('SIGTERM', () => controller.abort())

  log(
    `evidence worker started (supabase host: ${new URL(config.supabaseUrl).host}, mode: ${mode}, max attempts ${config.maxAttempts})`,
  )
  await runLoop(mode, controller.signal, {
    runNextJob: () =>
      runNextExtraction({
        store,
        getLlm: (context) =>
          context
            ? createMeteredLlm(llm, {
                actorUserId: context.actorUserId,
                projectId: context.projectId,
                feature: 'evidence_matrix',
                operationKey: context.operationKey,
                recordUsage,
                checkAllowance,
              })
            : llm,
        maxAttempts: config.maxAttempts,
        log,
        signal: controller.signal,
      }),
    pollIntervalMs: config.pollIntervalMs,
    sleep: abortableSleep,
    log,
  })
  log('evidence worker stopped')
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`Configuration error: ${error.message}`)
  } else {
    console.error('Evidence worker crashed:', describeError(error))
  }
  process.exit(1)
})
