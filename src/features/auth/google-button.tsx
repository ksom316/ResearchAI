import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.86c2.26-2.08 3.59-5.15 3.59-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.86-3c-1.07.72-2.44 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.29a12 12 0 0 0 0 10.74l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.63l3.98 3.09C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  )
}

export function GoogleButton({ redirectTo }: { redirectTo?: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function onClick() {
    setError(undefined)
    setPending(true)
    // Use the current origin so this works locally and on any deployment.
    // Supabase only honours it if it's in the project's Redirect URL allow-list.
    const callback = new URL('/auth/callback', window.location.origin)
    if (redirectTo) callback.searchParams.set('next', redirectTo)
    const { error: oauthError } =
      await getSupabaseBrowserClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callback.toString() },
      })
    if (oauthError) {
      setError('Couldn’t start Google sign-in. Please try again.')
      setPending(false)
    }
    // On success the browser is navigating to Google; keep the button busy.
  }

  return (
    <div className="space-y-4">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={pending}
        onClick={() => void onClick()}
      >
        {pending ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
        Continue with Google
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or continue with email
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}
