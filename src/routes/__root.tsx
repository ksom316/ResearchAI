import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'
import { Toaster } from '#/components/ui/sonner'
import { registerServiceWorker } from '#/lib/register-sw'

import { useEffect } from 'react'

import appCss from '../styles.css?url'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

const SITE_DESCRIPTION =
  'A provenance-first academic research workspace for grounded search, evidence synthesis, writing, citation checking, and corpus-quality inspection.'
const SITE_URL = 'https://research-ai-pearl-omega.vercel.app'
const ICON_PATH = '/evidara-icon.png'
const ICON_URL = `${SITE_URL}${ICON_PATH}`

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Evidara' },
      { name: 'description', content: SITE_DESCRIPTION },
      { name: 'application-name', content: 'Evidara' },
      { name: 'theme-color', content: '#ffffff' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Evidara' },
      { property: 'og:title', content: 'Evidara' },
      { property: 'og:description', content: SITE_DESCRIPTION },
      { property: 'og:url', content: SITE_URL },
      { property: 'og:image', content: ICON_URL },
      { property: 'og:image:secure_url', content: ICON_URL },
      { property: 'og:image:type', content: 'image/png' },
      {
        property: 'og:image:alt',
        content: 'Evidara application icon',
      },
      { name: 'twitter:card', content: 'summary' },
      { name: 'twitter:title', content: 'Evidara' },
      { name: 'twitter:description', content: SITE_DESCRIPTION },
      { name: 'twitter:image', content: ICON_URL },
      { name: 'twitter:image:alt', content: 'Evidara application icon' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/png', href: ICON_PATH },
      { rel: 'apple-touch-icon', href: ICON_PATH },
      { rel: 'manifest', href: '/manifest.webmanifest' },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (import.meta.env.PROD) registerServiceWorker()
  }, [])

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster richColors position="top-right" />
        {import.meta.env.DEV && (
          <TanStackDevtools
            config={{ position: 'bottom-right' }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
              TanStackQueryDevtools,
            ]}
          />
        )}
        <Scripts />
      </body>
    </html>
  )
}
