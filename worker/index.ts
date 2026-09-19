import { ConfigError, loadConfig } from './config'
import { describeError } from './diagnostics'
import { createSupabaseJobStore, createWorkerClient } from './job-store'
import { runLoop } from './loop'
import type { LoopMode } from './loop'
import { PdfJsExtractor } from './pdf-extractor'
import { runNextJob } from './run-job'

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
  await runLoop(mode, controller.signal, {
    runNextJob: () => runNextJob({ store, extractor, config, log }),
    pollIntervalMs: config.pollIntervalMs,
    log,
  })
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
