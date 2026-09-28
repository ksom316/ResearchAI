import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const pub = join(process.cwd(), 'public')
const manifest = JSON.parse(
  readFileSync(join(pub, 'manifest.webmanifest'), 'utf8'),
) as {
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  icons: { src: string; sizes: string; type: string; purpose: string }[]
}

function pngSize(file: string) {
  const b = readFileSync(file)
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

describe('PWA installability', () => {
  it('has required manifest fields', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true)
  })

  it('ships square 192, 512 and maskable icons that exist', () => {
    for (const [size, purpose] of [
      [192, 'any'],
      [512, 'any'],
      [512, 'maskable'],
    ] as const) {
      const icon = manifest.icons.find(
        (i) => i.sizes === `${size}x${size}` && i.purpose === purpose,
      )
      expect(icon).toBeDefined()
      const file = join(pub, icon!.src)
      expect(existsSync(file)).toBe(true)
      expect(pngSize(file)).toEqual([size, size])
    }
  })

  it('ships a service worker with a fetch handler', () => {
    expect(readFileSync(join(pub, 'sw.js'), 'utf8')).toContain("'fetch'")
  })

  it('links the manifest from the root route', () => {
    expect(
      readFileSync(join(process.cwd(), 'src/routes/__root.tsx'), 'utf8'),
    ).toContain('/manifest.webmanifest')
  })
})
