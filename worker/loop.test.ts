import { describe, expect, it, vi } from 'vitest'
import { abortableSleep, runLoop } from './loop'
import type { JobResult } from './run-job'

const idle: JobResult = { kind: 'idle' }
const ready: JobResult = { kind: 'ready', paperId: 'p', sections: 1, chunks: 1 }
const noSleep = async () => undefined

describe('runLoop', () => {
  it('once: runs exactly one job and returns, even if more work exists', async () => {
    const run = vi.fn(async () => ready)
    await runLoop('once', new AbortController().signal, {
      runNextJob: run,
      pollIntervalMs: 1000,
      sleep: noSleep,
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('drain: processes until the queue is empty, then returns without waiting', async () => {
    const results = [ready, ready, idle]
    const run = vi.fn(async () => results.shift() ?? idle)
    const sleep = vi.fn(noSleep)
    await runLoop('drain', new AbortController().signal, {
      runNextJob: run,
      pollIntervalMs: 1000,
      sleep,
    })
    expect(run).toHaveBeenCalledTimes(3)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('continuous: only sleeps when idle (no delay between busy jobs)', async () => {
    const controller = new AbortController()
    const results = [ready, ready, idle]
    const run = vi.fn(async () => results.shift() ?? idle)
    const sleep = vi.fn(async () => controller.abort())
    await runLoop('continuous', controller.signal, {
      runNextJob: run,
      pollIntervalMs: 7000,
      sleep,
    })
    expect(run).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(7000, controller.signal)
  })

  it('continuous: backs off exponentially on errors, capped, and recovers', async () => {
    const controller = new AbortController()
    let calls = 0
    const run = vi.fn(async (): Promise<JobResult> => {
      calls++
      if (calls <= 8) throw new Error('db down')
      controller.abort()
      return ready
    })
    const delays: number[] = []
    await runLoop('continuous', controller.signal, {
      runNextJob: run,
      pollIntervalMs: 10_000,
      sleep: async (ms) => {
        delays.push(ms)
      },
    })
    expect(delays[0]).toBe(20_000)
    expect(delays[1]).toBe(40_000)
    expect(Math.max(...delays)).toBe(5 * 60_000)
  })

  it('once/drain surface errors instead of swallowing them', async () => {
    const run = vi.fn(async (): Promise<JobResult> => {
      throw new Error('boom')
    })
    await expect(
      runLoop('once', new AbortController().signal, {
        runNextJob: run,
        pollIntervalMs: 1000,
      }),
    ).rejects.toThrow('boom')
  })

  it('stops promptly when aborted while idle-sleeping', async () => {
    const controller = new AbortController()
    const run = vi.fn(async () => idle)
    const promise = runLoop('continuous', controller.signal, {
      runNextJob: run,
      pollIntervalMs: 60_000,
    })
    await new Promise((r) => setTimeout(r, 20))
    controller.abort()
    await promise // resolves without waiting 60s
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not start a new job after the signal aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const run = vi.fn(async () => ready)
    await runLoop('continuous', controller.signal, {
      runNextJob: run,
      pollIntervalMs: 1000,
    })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('abortableSleep', () => {
  it('resolves immediately for an already-aborted signal', async () => {
    const c = new AbortController()
    c.abort()
    await abortableSleep(60_000, c.signal)
  })
})
