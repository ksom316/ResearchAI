import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')
const packageJson = JSON.parse(read('package.json')) as {
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

describe('production worker packaging', () => {
  it('keeps both persistent start commands and ships their TypeScript runtime', () => {
    expect(packageJson.scripts.worker).toBe(
      'tsx worker/index.ts',
    )
    expect(packageJson.scripts['worker:evidence']).toBe(
      'tsx worker/evidence-worker.ts',
    )
    expect(packageJson.scripts['worker:local']).toContain(
      '--env-file=.env.worker',
    )
    expect(packageJson.scripts['worker:evidence:local']).toContain(
      '--env-file=.env.worker',
    )
    expect(packageJson.dependencies.tsx).toBeTruthy()
    expect(packageJson.devDependencies.tsx).toBeUndefined()
  })

  it('uses one non-root production image for either worker without copying env files', () => {
    const dockerfile = read('Dockerfile.worker')
    expect(dockerfile).toContain('npm ci --omit=dev')
    expect(dockerfile).toContain('USER node')
    expect(dockerfile).toContain('CMD ["npm", "run", "worker"]')
    expect(dockerfile).not.toMatch(/COPY\s+\.\s+/u)
    expect(dockerfile).not.toMatch(
      /SUPABASE_SERVICE_ROLE_KEY|OPENROUTER_API_KEY|EMBEDDING_API_KEY/u,
    )
  })

  it('keeps local secrets ignored and documents required production configuration', () => {
    expect(read('.gitignore')).toMatch(/^\.env\.worker$/m)
    const example = read('.env.worker.example')
    expect(example).toMatch(/^EMBEDDING_STAGE_ENABLED=true$/m)
    expect(example).toMatch(/^LLM_MODEL=openrouter\/free$/m)
    const docs = read('WORKER_DEPLOYMENT.md')
    expect(docs).toContain('npm run worker')
    expect(docs).toContain('npm run worker:evidence')
    expect(docs).toContain('Never expose it to the browser')
  })
})
