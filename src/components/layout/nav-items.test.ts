import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, isUnderPrefix } from './nav-items'

describe('isUnderPrefix', () => {
  it.each([
    ['/papers', '/papers', true],
    ['/papers/abc-123', '/papers', true],
    ['/papers/abc/extra', '/papers', true],
    ['/papers-old/abc', '/papers', false],
    ['/library', '/papers', false],
    ['/', '/papers', false],
  ])('%s under %s -> %s', (pathname, prefix, expected) => {
    expect(isUnderPrefix(pathname, prefix)).toBe(expected)
  })
})

describe('NAV_ITEMS', () => {
  it('keeps Library active for paper detail pages, and only Library', () => {
    const withExtra = NAV_ITEMS.filter((item) => item.alsoActiveFor)
    expect(withExtra.map((item) => item.to)).toEqual(['/library'])
    expect(withExtra[0].alsoActiveFor).toEqual(['/papers'])
  })

  it('leaves the other navigation entries unchanged', () => {
    expect(NAV_ITEMS.map((item) => [item.to, item.label])).toEqual([
      ['/dashboard', 'Dashboard'],
      ['/projects', 'Research Projects'],
      ['/library', 'Library'],
      ['/settings', 'Settings'],
    ])
  })
})
