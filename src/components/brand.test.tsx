import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Brand } from './brand'

describe('Brand', () => {
  it('renders the canonical Evidara icon without cropping', () => {
    const output = renderToStaticMarkup(createElement(Brand))

    expect(output).toContain('src="/evidara-icon.png"')
    expect(output).toContain('object-contain')
    expect(output).toContain('>Evidara<')
  })
})
