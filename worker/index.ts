import { ConfigError, loadConfig } from './config'
import { describeError } from './diagnostics'
import { createSupabaseJobStore, createWorkerClient } from './job-store'
import { abortableSleep, runLoop } from './loop'
import type { LoopMode } from './loop'
import { createEmbeddingRunner } from './embedding/create-runner'
import { loadEnabledEmbeddingConfig } from './embedding-config'
import { PdfJsExtractor } from './pdf-extractor'
import { runNextJob } from './run-job'
import { runScheduler } from './scheduler'

/**
 * Local PDF processing worker.
 *   npm run worker         keep polling for uploaded papers (Ctrl+C to stop)
 *   npm run worker:once    process one paper and exit
 *   npm run worker:drain   process everything pending, then exit
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
  // Production continuous mode always includes indexing. One-shot/drain commands
  // remain PDF-only operational tools and therefore do not require Voyage config.
  const embeddingConfig =
    mode === 'continuous' ? loadEnabledEmbeddingConfig() : null

  const store = createSupabaseJobStore(createWorkerClient(config), config)
  const extractor = new PdfJsExtractor({ timeoutMs: config.jobTimeoutMs })

  const controller = new AbortController()
  const stop = (signal: string) => {
    if (controller.signal.aborted) {
      log(`${signal} again: exiting immediately`)
      process.exit(1)
    }
    log(`${signal} received: finishing the current job, then stopping`)
    controller.abort()
  }
  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))

  log(
    `worker started (supabase host: ${new URL(config.supabaseUrl).host}, mode: ${mode}, poll ${config.pollIntervalMs / 1000}s, max attempts ${config.maxAttempts})`,
  )
  if (embeddingConfig) {
    const runner = createEmbeddingRunner({
      client: createWorkerClient(config),
      config: embeddingConfig,
      log,
    })
    log(
      `embedding stage enabled (voyage-4, ${embeddingConfig.requestsPerMinute} req/min, ` +
        `${embeddingConfig.tokensPerMinute} tokens/min)`,
    )
    await runScheduler(controller.signal, {
      pdf: () => runNextJob({ store, extractor, config, log }),
      embedding: runner,
      pollIntervalMs: config.pollIntervalMs,
      now: Date.now,
      sleep: abortableSleep,
      log,
    })
  } else {
    await runLoop(mode, controller.signal, {
      runNextJob: () => runNextJob({ store, extractor, config, log }),
      pollIntervalMs: config.pollIntervalMs,
      log,
    })
  }
  log('worker stopped')
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`Configuration error: ${error.message}`)
  } else {
    console.error('Worker crashed:', describeError(error))
  }
  process.exit(1)
})
