import { FlaskConical, LayoutDashboard, Library, Settings } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavItem = {
  to: '/dashboard' | '/projects' | '/library' | '/settings'
  label: string
  icon: LucideIcon
  /** Other URL prefixes that belong to this section (keeps it highlighted). */
  alsoActiveFor?: readonly string[]
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/projects', label: 'Research Projects', icon: FlaskConical },
  // A paper's detail page (/papers/$paperId) is part of the Library.
  {
    to: '/library',
    label: 'Library',
    icon: Library,
    alsoActiveFor: ['/papers'],
  },
  { to: '/settings', label: 'Settings', icon: Settings },
]

/** True if `pathname` is `prefix` itself or a page below it (not just a shared string prefix). */
export function isUnderPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}
