import { describe, expect, it, vi } from 'vitest'
import type { StepResult } from './embedding/runner'
import type { JobResult } from './run-job'
import { runScheduler } from './scheduler'

const idle: JobResult = { kind: 'idle' }
const ready: JobResult = { kind: 'ready', paperId: 'p', sections: 1, chunks: 1 }

/** A virtual clock + sleep that records every nap and never really waits. */
function harness() {
  let t = 0
  const controller = new AbortController()
  const naps: number[] = []
  const events: string[] = []
  return {
    controller,
    naps,
    events,
    now: () => t,
    sleep: async (ms: number, signal: AbortSignal) => {
      naps.push(ms)
      if (!signal.aborted) t += ms
    },
    advance: (ms: number) => (t += ms),
  }
}

const embedding = (steps: (n: number) => StepResult | Promise<StepResult>) => {
  let n = 0
  return {
    step: vi.fn(async () => steps(++n)),
    release: vi.fn(async (): Promise<StepResult> => ({ kind: 'idle' })),
  }
}

describe('runScheduler: one process, two lifecycles', () => {
  it('polls the PDF lane before the embedding lane on every pass', async () => {
    const h = harness()
    const order: string[] = []
    let passes = 0
    await runScheduler(h.controller.signal, {
      pdf: async () => {
        order.push('pdf')
        return idle
      },
      embedding: embedding(() => {
        order.push('embed')
        if (++passes === 3) h.controller.abort()
        return { kind: 'progress', embedded: 1, remaining: 5 }
      }),
      pollIntervalMs: 10_000,
      now: h.now,
      sleep: h.sleep,
    })
    expect(order.slice(0, 4)).toEqual(['pdf', 'embed', 'pdf', 'embed'])
  })

  it('a PDF job is not held up by embedding pacing waits', async () => {
    const h = harness()
    const pdfResults = [idle, idle, ready, idle]
    let pdfCalls = 0
    const emb = embedding(() => ({ kind: 'waiting', waitMs: 55_000 })) // Voyage says: wait ~1 minute
    await runScheduler(h.controller.signal, {
      pdf: async () => {
        const result = pdfResults[pdfCalls++] ?? idle
        if (pdfCalls >= 5) h.controller.abort()
        return result
      },
      embedding: emb,
      pollIntervalMs: 10_000,
      now: h.now,
      sleep: h.sleep,
    })
    // The scheduler napped only 10s at a time (not 55s), so the PDF job at pass 3 ran within ~20s.
    expect(h.naps.filter((ms) => ms > 10_000)).toHaveLength(0)
    expect(pdfCalls).toBeGreaterThanOrEqual(4)
    expect(h.now()).toBeLessThan(55_000)
  })

  it('naps only as long as pacing requires when that is shorter than the poll interval', async () => {
    const h = harness()
    let n = 0
    await runScheduler(h.controller.signal, {
      pdf: async () => idle,
      embedding: embedding(() => {
        if (++n === 2) h.controller.abort()
        return { kind: 'waiting', waitMs: 2_500 }
      }),
      pollIntervalMs: 10_000,
      now: h.now,
      sleep: h.sleep,
    })
    expect(h.naps[0]).toBe(2_500)
  })

  it('does not busy-wait: with both lanes idle it sleeps for the poll interval', async () => {
    const h = harness()
    let passes = 0
    await runScheduler(h.controller.signal, {
      pdf: async () => {
        if (++passes === 4) h.controller.abort()
        return idle
      },
      embedding: embedding(() => ({ kind: 'idle' })),
      pollIntervalMs: 10_000,
      now: h.now,
      sleep: h.sleep,
    })
    expect(h.naps.length).toBeGreaterThan(0)
    expect(h.naps.every((ms) => ms === 10_000)).toBe(true)
  })

  it('keeps going immediately after PDF work (no idle nap between busy jobs)', async () => {
    const h = harness()
    let calls = 0
    await runScheduler(h.controller.signal, {
      pdf: async () => {
        if (++calls === 3) h.controller.abort()
        return ready
      },
      pollIntervalMs: 10_000,
      now: h.now,
      sleep: h.sleep,
    })
    expect(h.naps).toEqual([])
  })

  it('works without an embedding lane (the existing PDF-only behavior)', async () => {
    const h = harness()
    let calls = 0
    await runScheduler(h.controller.signal, {
      pdf: async () => {
        if (++calls === 2) h.controller.abort()
        return idle
      },
      pollIntervalMs: 5_000,
      now: h.now,
      sleep: h.sleep,
    })
    expect(h.naps).toEqual([5_000])
  })
})

describe('runScheduler: lanes fail independently', () => {
  it('an embedding error backs that lane off but PDF processing continues', async () => {
    const h = harness()
    let pdfCalls = 0
    const emb = embedding(() => {
      throw new Error('provider exploded')
    })
    await runScheduler(h.controller.signal, {
      pdf: async () => {
        if (++pdfCalls === 6) h.controller.abort()
        return idle
      },
      embedding: emb,
      pollIntervalMs: 10_000,
      now: h.now,
      sleep: h.sleep,
    })
    expect(pdfCalls).toBe(6)
    expect(emb.step.mock.calls.length).toBeLessThan(pdfCalls) // the lane was paused, not hammered
  })

  it('a PDF error backs the PDF lane off but embedding continues', async () => {
    const h = harness()
    let embedCalls = 0
    await runScheduler(h.controller.signal, {
      pdf: async () => {
        throw new Error('db down')
      },
      embedding: embedding(() => {
        if (++embedCalls === 4) h.controller.abort()
        return { kind: 'idle' }
      }),
      pollIntervalMs: 10_000,
      now: h.now,
      sleep: h.sleep,
    })
    expect(embedCalls).toBe(4)
  })

  it('a stage-wide block (e.g. unusable key) pauses only the embedding lane for minutes', async () => {
    const h = harness()
    let pdfCalls = 0
    const emb = embedding(() => ({
      kind: 'blocked',
      reason: 'Voyage rejected the API key (HTTP 401)',
    }))
    const logs: string[] = []
    await runScheduler(h.controller.signal, {
      pdf: async () => {
        if (++pdfCalls === 5) h.controller.abort()
        return idle
      },
      embedding: emb,
      pollIntervalMs: 10_000,
      now: h.now,
      sleep: h.sleep,
      log: (m) => logs.push(m),
    })
    expect(emb.step).toHaveBeenCalledTimes(1) // not retried during the rest period
    expect(pdfCalls).toBe(5)
    expect(logs.join(' ')).toContain('embedding stage paused')
  })

  it('safe logging: error messages only, never stack traces or secrets', async () => {
    const h = harness()
    const logs: string[] = []
    let n = 0
    await runScheduler(h.controller.signal, {
      pdf: async () => {
        if (++n === 2) h.controller.abort()
        throw new Error('boom')
      },
      pollIntervalMs: 1_000,
      now: h.now,
      sleep: h.sleep,
      log: (m) => logs.push(m),
    })
    expect(logs.join('\n')).toContain('pdf lane error: boom')
    expect(logs.join('\n')).not.toMatch(/\bat .*\.ts/)
  })
})

describe('runScheduler: graceful shutdown', () => {
  it('shutdown while pacing: stops promptly and releases the claimed indexing job', async () => {
    const h = harness()
    const emb = embedding(() => ({ kind: 'waiting', waitMs: 50_000 }))
    let sleeps = 0
    await runScheduler(h.controller.signal, {
      pdf: async () => idle,
      embedding: emb,
      pollIntervalMs: 10_000,
      now: h.now,
      sleep: async (ms, signal) => {
        sleeps++
        h.naps.push(ms)
        h.controller.abort() // SIGINT arrives while the scheduler is waiting out the pacing delay
        expect(signal.aborted).toBe(true)
      },
    })
    expect(sleeps).toBe(1)
    expect(emb.release).toHaveBeenCalledTimes(1)
  })

  it('releases the job even if the loop ends because of an abort between passes', async () => {
    const h = harness()
    const emb = embedding(() => ({
      kind: 'progress',
      embedded: 1,
      remaining: 2,
    }))
    h.controller.abort()
    await runScheduler(h.controller.signal, {
      pdf: async () => idle,
      embedding: emb,
      pollIntervalMs: 10_000,
      now: h.now,
      sleep: h.sleep,
    })
    expect(emb.step).not.toHaveBeenCalled()
    expect(emb.release).toHaveBeenCalledTimes(1)
  })

  it('does not start a new embedding request after the signal aborts mid-pass', async () => {
    const h = harness()
    const emb = embedding(() => ({ kind: 'idle' }))
    await runScheduler(h.controller.signal, {
      pdf: async () => {
        h.controller.abort() // abort arrives during the PDF poll
        return idle
      },
      embedding: emb,
      pollIntervalMs: 10_000,
      now: h.now,
      sleep: h.sleep,
    })
    expect(emb.step).not.toHaveBeenCalled()
    expect(emb.release).toHaveBeenCalled()
  })
})
