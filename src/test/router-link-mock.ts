import { createElement } from 'react'

import type { AnchorHTMLAttributes, ReactNode } from 'react'

type RouterLinkMockProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children?: ReactNode
  params?: Record<string, string>
  to?: string
}

export function RouterLinkMock({
  children,
  params,
  to = '#',
  ...props
}: RouterLinkMockProps) {
  const href = Object.entries(params ?? {}).reduce(
    (path, [key, value]) => path.replace(`$${key}`, value),
    to,
  )

  return createElement('a', { ...props, href }, children)
}
