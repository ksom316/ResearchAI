import type { JobResult } from './run-job'

export type LoopMode = 'continuous' | 'once' | 'drain'

export type LoopDeps = {
  runNextJob: () => Promise<JobResult>
  pollIntervalMs: number
  /** Resolves after ms, or immediately when `signal` aborts. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  log?: (message: string) => void
}

const ERROR_BACKOFF_MAX_MS = 5 * 60_000

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * once:       process at most one paper, then return.
 * drain:      keep processing until nothing is eligible, then return.
 * continuous: process while there is work; when idle wait `pollIntervalMs`
 *             (so an empty queue costs one cheap RPC per interval); on errors
 *             back off exponentially up to 5 minutes. Stops cleanly when
 *             `signal` aborts, after the in-flight job (if any) finishes.
 */
export async function runLoop(
  mode: LoopMode,
  signal: AbortSignal,
  deps: LoopDeps,
): Promise<void> {
  const sleep = deps.sleep ?? abortableSleep
  let consecutiveErrors = 0

  while (!signal.aborted) {
    let result: JobResult
    try {
      result = await deps.runNextJob()
      consecutiveErrors = 0
    } catch (error) {
      if (mode !== 'continuous') throw error
      consecutiveErrors++
      const delay = Math.min(
        deps.pollIntervalMs * 2 ** consecutiveErrors,
        ERROR_BACKOFF_MAX_MS,
      )
      deps.log?.(
        `error: ${error instanceof Error ? error.message : String(error)}; retrying in ${Math.round(delay / 1000)}s`,
      )
      await sleep(delay, signal)
      continue
    }

    if (mode === 'once') return
    if (result.kind === 'idle') {
      if (mode === 'drain') return
      await sleep(deps.pollIntervalMs, signal)
    }
  }
}
