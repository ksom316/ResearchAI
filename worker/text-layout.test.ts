import { describe, expect, it } from 'vitest'
import { itemsToText } from './text-layout'
import type { LayoutItem } from './text-layout'

const item = (
  str: string,
  x: number,
  y: number,
  extra: Partial<LayoutItem> = {},
): LayoutItem => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width: str.length * 5,
  height: 10,
  ...extra,
})

describe('itemsToText', () => {
  it('joins items on the same baseline, adding spaces only for real gaps', () => {
    expect(
      itemsToText([
        item('Hel', 0, 100),
        item('lo', 15, 100),
        item('world', 40, 100),
      ]),
    ).toBe('Hello world')
  })

  it('starts a new line when the baseline moves', () => {
    expect(
      itemsToText([item('Abstract', 0, 700), item('Text here', 0, 686)]),
    ).toBe('Abstract\nText here')
  })

  it('inserts a blank line for a large vertical gap (paragraph break)', () => {
    expect(itemsToText([item('First', 0, 700), item('Second', 0, 660)])).toBe(
      'First\n\nSecond',
    )
  })

  it('honors hasEOL and skips empty items', () => {
    expect(
      itemsToText([
        item('one', 0, 100, { hasEOL: true }),
        item('', 0, 100),
        item('two', 20, 100),
      ]),
    ).toBe('one\ntwo')
  })

  it('returns an empty string when there is no text', () => {
    expect(itemsToText([])).toBe('')
    expect(itemsToText([item('', 0, 0), item('   ', 0, 0)])).toBe('')
  })

  it('keeps stream order rather than sorting by position', () => {
    // A second column written after the first stays after it.
    expect(
      itemsToText([item('left col', 0, 700), item('right col', 300, 700 - 14)]),
    ).toBe('left col\nright col')
  })
})
