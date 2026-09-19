import { ConfigError, loadConfig } from './config'
import { describeError } from './diagnostics'
import {
  createEmbeddingRunner,
  EXPECTED_PROFILE,
} from './embedding/create-runner'
import { loadPaperSnapshot } from './embedding/job-store'
import { planChunks, takeBatch } from './embedding/plan'
import { paceLimits, simulatePacing } from './embedding/rate-limiter'
import { TokenEstimator } from './embedding/token-estimator'
import { loadEmbeddingConfig } from './embedding-config'
import { createWorkerClient } from './job-store'
import { abortableSleep } from './loop'

/**
 * Manual, ONE-paper indexing command. Never indexes the library.
 *
 *   npm run embedding:index:dry -- <paper-id>   preview only: ALWAYS a dry run (no Voyage call, no writes)
 *   npm run embedding:index -- <paper-id>       index that one ready paper
 *
 * Use the :dry script for previews. npm can swallow a trailing "--dry-run" flag as
 * one of its own options, so the dry-run flag is built into that script instead.
 * Claiming is restricted to the given paper, so no other paper's job is created or
 * touched. Prints only safe metadata: ids, counts, tokens, timing, status. Never
 * vectors, paper text, keys or headers.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const log = (message: string) =>
  console.log(`[${new Date().toISOString()}] ${message}`)
const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)} min`

async function main() {
  const args = process.argv.slice(2)
  const paperId = args.find((a) => !a.startsWith('--'))
  const dryRun = args.includes('--dry-run')
  if (!paperId || !UUID.test(paperId)) {
    throw new ConfigError(
      'Usage: npm run embedding:index:dry -- <paper-id> (preview, no changes) | ' +
        'npm run embedding:index -- <paper-id> (index that one paper). ' +
        'The paper-id must be a UUID.',
    )
  }

  const workerConfig = loadConfig()
  const config = loadEmbeddingConfig()
  const client = createWorkerClient(workerConfig)

  // ---- preview (read-only) --------------------------------------------------------
  const paper = await client
    .from('papers')
    .select('title, status')
    .eq('id', paperId)
    .maybeSingle()
  if (paper.error || !paper.data) {
    throw new ConfigError('Paper not found (or it could not be read).')
  }
  const model = await client
    .from('embedding_models')
    .select('id, status')
    .eq('status', 'active')
    .maybeSingle()
  const modelId = (model.data as { id: string } | null)?.id
  if (!modelId)
    throw new ConfigError('No active embedding profile in embedding_models.')

  const snapshot = await loadPaperSnapshot(client, paperId, modelId)
  const plan = planChunks(snapshot)
  const estimator = new TokenEstimator()
  const limits = paceLimits({
    requestsPerMinute: config.requestsPerMinute,
    tokensPerMinute: config.tokensPerMinute,
  })

  const batches: number[] = []
  for (let queue = plan.pending; queue.length > 0;) {
    const batch = takeBatch(
      queue,
      { maxItems: config.batchSize, maxTokens: config.maxRequestTokens },
      (chars) => estimator.estimate(chars),
    )
    batches.push(estimator.estimate(batch.reduce((n, c) => n + c.chars, 0)))
    queue = queue.slice(batch.length)
  }
  const estimatedTokens = batches.reduce((a, b) => a + b, 0)
  const pacing = simulatePacing(batches, limits)

  log(`paper ${paperId}: status ${(paper.data as { status: string }).status}`)
  log(
    `profile ${modelId} (${EXPECTED_PROFILE.provider}/${EXPECTED_PROFILE.providerModel}/${EXPECTED_PROFILE.dimensions}/${EXPECTED_PROFILE.inputProfile})`,
  )
  log(
    `chunks: ${plan.total} total, ${plan.reused} already embedded (reusable), ${plan.pending.length} to embed`,
  )
  log(
    `estimate: ~${estimatedTokens} tokens in ${pacing.requests} request(s) ` +
      `(pessimistic ${estimator.charsPerToken} chars/token; actual billing is usually lower)`,
  )
  log(
    `limits: ${config.requestsPerMinute} requests/min, ${config.tokensPerMinute} tokens/min ` +
      `(paced to ${limits.maxTokens} tokens/min) -> expected runtime ~${minutes(pacing.totalMs)}`,
  )

  if (dryRun) {
    log('dry run: nothing was sent to Voyage and nothing was written.')
    return
  }
  if ((paper.data as { status: string }).status !== 'ready') {
    throw new ConfigError(
      'Only a paper whose PDF processing status is "ready" can be indexed.',
    )
  }

  // ---- index this one paper -----------------------------------------------------------
  const controller = new AbortController()
  process.on('SIGINT', () => {
    log('SIGINT: releasing the job and stopping')
    controller.abort()
  })
  const runner = createEmbeddingRunner({ client, config, paperId, log })

  const started = Date.now()
  let outcome = 'unknown'
  let summary: {
    chunksTotal: number
    newlyEmbedded: number
    reused: number
    requests: number
    billedTokens: number
  } | null = null

  loop: while (!controller.signal.aborted) {
    const step = await runner.step(controller.signal)
    switch (step.kind) {
      case 'waiting':
        await abortableSleep(step.waitMs, controller.signal)
        break
      case 'progress':
        break
      case 'complete':
        summary = step.summary
        outcome = 'complete'
        break loop
      case 'idle':
        outcome =
          'no eligible job (already complete, waiting on a retry delay, or not ready)'
        break loop
      case 'retry':
      case 'failed':
      case 'lost':
      case 'interrupted':
        outcome = step.kind
        break loop
      case 'blocked':
        outcome = `blocked: ${step.reason}`
        break loop
    }
  }
  if (controller.signal.aborted) await runner.release()

  const job = await client
    .from('paper_embedding_jobs')
    .select('status, embedded_count, chunk_count, attempts')
    .eq('paper_id', paperId)
    .eq('model_id', modelId)
    .maybeSingle()
  const status = job.data as {
    status: string
    embedded_count: number
    chunk_count: number | null
  } | null

  console.log('\nIndexing summary')
  console.log(`  paper:                ${paperId}`)
  console.log(`  outcome:              ${outcome}`)
  console.log(`  chunks total:         ${summary?.chunksTotal ?? plan.total}`)
  console.log(`  chunks newly embedded: ${summary?.newlyEmbedded ?? 0}`)
  console.log(`  chunks reused:        ${summary?.reused ?? plan.reused}`)
  console.log(`  requests:             ${summary?.requests ?? 0}`)
  console.log(`  billed tokens:        ${summary?.billedTokens ?? 0}`)
  console.log(`  elapsed:              ${minutes(Date.now() - started)}`)
  console.log(
    `  indexing status:      ${status ? `${status.status} (${status.embedded_count}/${status.chunk_count ?? '?'} chunks)` : 'no job'}`,
  )
  if (outcome !== 'complete') process.exitCode = 1
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`Error: ${error.message}`)
  } else {
    console.error('Indexing command failed:', describeError(error))
  }
  process.exit(1)
})
