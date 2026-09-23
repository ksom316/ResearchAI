import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Brand } from './brand'

describe('Brand', () => {
  it('renders the canonical ResearchAI icon without cropping', () => {
    const output = renderToStaticMarkup(createElement(Brand))

    expect(output).toContain('src="/researchai-icon.png"')
    expect(output).toContain('object-contain')
    expect(output).toContain('>ResearchAI<')
  })
})
