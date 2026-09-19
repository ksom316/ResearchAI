import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronsUpDown, LogOut, Settings } from 'lucide-react'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { signOutFn } from '#/lib/auth/auth.functions'
import { getInitials } from '#/lib/format'
import type { AuthUser } from '#/lib/auth/auth.functions'

export function UserMenu({ user }: { user: AuthUser }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    try {
      await signOutFn()
      queryClient.clear()
      await router.invalidate()
      await router.navigate({ to: '/sign-in' })
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring">
        <Avatar className="size-9">
          <AvatarFallback className="bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
            {getInitials(user.fullName)}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">
            {user.fullName}
          </span>
          <span className="block truncate text-xs text-sidebar-foreground/60">
            {user.email}
          </span>
        </span>
        <ChevronsUpDown className="size-4 text-sidebar-foreground/60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.navigate({ to: '/settings' })}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem disabled={signingOut} onSelect={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
