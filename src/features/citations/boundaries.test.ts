import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const directory = new URL('.', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
)
const sources = readdirSync(directory)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => readFileSync(join(directory, name), 'utf8'))
  .join('\n')

describe('citation domain boundaries', () => {
  it('has no database, environment, network, provider, HTML, or inference path', () => {
    expect(sources).not.toMatch(
      /supabase|service[_-]?role|process\.env|fetch\s*\(|openrouter|generateStructured|dangerouslySetInnerHTML|original_filename|originalFilename/i,
    )
  })

  it('does not import Writer, Claim Checker, or browser UI modules', () => {
    expect(sources).not.toMatch(
      /features\/(?:writer|claim-checker)|react|components\/|\.server/i,
    )
  })
})
