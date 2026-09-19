import { ConfigError } from './config'
import { loadEmbeddingConfig } from './embedding-config'
import { EmbeddingError } from '../src/lib/embedding/errors'
import { createVoyageProvider } from '../src/lib/embedding/voyage'

/**
 * Controlled live check of the Voyage client: ONE request, embedding ONE tiny
 * harmless string. Run manually (never from npm test):
 *
 *   npm run embedding:smoke
 *
 * Prints only safe metadata: provider, model, dimension, count, tokens, elapsed
 * time. It never prints the API key, the Authorization header, or the vector.
 */

const SAMPLE = 'Machine learning models learn patterns from data.'

async function main() {
  const config = loadEmbeddingConfig()
  // One attempt: a smoke test should report a problem, not retry around it.
  const provider = createVoyageProvider({
    apiKey: config.apiKey,
    batchSize: config.batchSize,
    timeoutMs: config.timeoutMs,
    maxAttempts: 1,
  })

  const started = Date.now()
  const { vectors, tokens } = await provider.embedDocuments([SAMPLE])
  const elapsedMs = Date.now() - started

  const first = vectors[0]
  const finite = first.every((value) => Number.isFinite(value))
  console.log('Voyage embedding smoke test: OK')
  console.log(`  provider:        ${provider.profile.provider}`)
  console.log(`  model:           ${provider.profile.model}`)
  console.log(`  embeddings:      ${vectors.length}`)
  console.log(`  vector dimension: ${first.length}`)
  console.log(`  all values finite: ${finite}`)
  console.log(`  tokens billed:   ${tokens ?? 'not reported'}`)
  console.log(`  elapsed:         ${elapsedMs} ms`)
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`Configuration error: ${error.message}`)
  } else if (error instanceof EmbeddingError) {
    // Messages are safe by construction (no key, header or body).
    console.error(
      `Voyage embedding smoke test FAILED [${error.kind}]: ${error.message}`,
    )
    if (error.status !== undefined)
      console.error(`  HTTP status: ${error.status}`)
  } else {
    console.error('Voyage embedding smoke test FAILED: unexpected error')
  }
  process.exit(1)
})
