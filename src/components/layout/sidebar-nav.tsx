import { Link, useRouterState } from '@tanstack/react-router'
import { Brand } from '#/components/brand'
import { UserMenu } from './user-menu'
import { NAV_ITEMS, isUnderPrefix } from './nav-items'
import { cn } from '#/lib/utils'
import type { AuthUser } from '#/lib/auth/auth.functions'

/** Sidebar contents; reused by the desktop rail and the mobile drawer. */
export function SidebarNav({
  user,
  onNavigate,
}: {
  user: AuthUser
  onNavigate?: () => void
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 py-5">
        <Brand tone="light" />
      </div>
      <nav className="flex-1 space-y-1 px-3" aria-label="Main">
        {NAV_ITEMS.map(({ to, label, icon: Icon, alsoActiveFor }) => {
          // Router marks the exact/parent route active; this covers related sections.
          const inSection =
            alsoActiveFor?.some((prefix) => isUnderPrefix(pathname, prefix)) ??
            false
          return (
            <Link
              key={to}
              to={to}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground',
                inSection && 'bg-sidebar-accent text-sidebar-accent-foreground',
              )}
            >
              <Icon className="size-[18px]" />
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <UserMenu user={user} />
      </div>
    </div>
  )
}
