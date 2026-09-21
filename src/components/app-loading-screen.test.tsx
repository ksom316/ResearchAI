import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppLoadingScreen } from './app-loading-screen'

describe('AppLoadingScreen', () => {
  it('renders accessible ResearchAI loading branding without layout overflow', () => {
    const output = renderToStaticMarkup(createElement(AppLoadingScreen))

    expect(output).toContain('role="status"')
    expect(output).toContain('aria-label="ResearchAI is loading"')
    expect(output).toContain('src="/researchai-icon.png"')
    expect(output).toContain('>ResearchAI<')
    expect(output).toContain('Turning papers into evidence.')
    expect(output).toContain('overflow-hidden')
  })

  it('respects reduced motion and is limited to initial route boundaries', () => {
    const component = readFileSync('src/components/app-loading-screen.tsx', 'utf8')
    const homeRoute = readFileSync('src/routes/index.tsx', 'utf8')
    const authedRoute = readFileSync('src/routes/_authed.tsx', 'utf8')
    const router = readFileSync('src/router.tsx', 'utf8')

    expect(component).toContain('motion-reduce:animate-none')
    expect(homeRoute).toContain('pendingComponent: AppLoadingScreen')
    expect(authedRoute).toContain('pendingComponent: AppLoadingScreen')
    expect(homeRoute).toContain('pendingMinMs: 0')
    expect(authedRoute).toContain('pendingMinMs: 0')
    expect(router).not.toContain('defaultPendingComponent')
  })
})
