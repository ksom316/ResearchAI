import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('responsive overlay primitives', () => {
  it('gives Sheet and Dialog close controls mobile-safe touch targets', () => {
    for (const file of ['sheet.tsx', 'dialog.tsx']) {
      const source = read(file)
      expect(source, file).toContain('size-10')
      expect(source, file).toContain('items-center justify-center')
      expect(source, file).toContain('sm:size-8')
      expect(source, file).toContain('<span className="sr-only">Close</span>')
    }
  })
})
