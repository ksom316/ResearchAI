import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LandingPage } from './landing-page'
import { landingDestinationForUser } from './routing'

vi.mock('@tanstack/react-router', async () => ({
  Link: (await import('#/test/router-link-mock')).RouterLinkMock,
}))

describe('ResearchAI public landing page', () => {
  const render = () => renderToStaticMarkup(createElement(LandingPage))

  it('renders the product promise and every implemented feature', () => {
    const output = render()

    expect(output).toContain(
      'Turn research papers into evidence you can actually work with.',
    )
    for (const feature of [
      'Evidence Matrix',
      'Research Map',
      'Research Gap Explorer',
      'Grounded Research Chat',
      'Academic Writer',
      'Claim Checker',
      'Research Quality Inspector',
    ]) {
      expect(output).toContain(feature)
    }
    expect(output).toContain('Not simply “chat with PDFs.”')
    expect(output).toContain('Grounding you can inspect')
  })

  it('routes primary calls to signup and sign-in actions to signin', () => {
    const output = render()

    expect(output).toMatch(/href="\/sign-up"[^>]*>[^<]*Start researching/)
    expect(output).toMatch(/href="\/sign-in"[^>]*>Sign in/)
    expect(output).toContain('href="#how-it-works"')
  })

  it('provides semantic sections and an accessible mobile navigation menu', () => {
    const output = render()

    expect(output).toContain('<nav aria-label="Main navigation"')
    expect(output).toContain('<summary')
    expect(output).toContain('Open navigation menu')
    expect(output).toContain('id="features"')
    expect(output).toContain('id="how-it-works"')
    expect(output).toContain('id="why-researchai"')
    expect(output).toContain('overflow-x-clip')
    expect(output).toContain('src="/researchai-icon.png"')
  })
})

describe('landing route authentication decision', () => {
  it('keeps unauthenticated visitors on the landing page', () => {
    expect(landingDestinationForUser(null)).toBeNull()
  })

  it('sends authenticated users to their dashboard', () => {
    expect(
      landingDestinationForUser({
        id: 'user-id',
        email: 'researcher@example.com',
        fullName: 'Researcher',
      }),
    ).toBe('/dashboard')
  })
})
