import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { AlertCircle, Loader2, MailCheck } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { forgotPasswordSchema } from '#/lib/auth/schemas'
import { getSupabaseBrowserClient } from '#/lib/supabase/client'
import { AuthCard } from './auth-card'
import { FormField } from './form-field'

export function ForgotPasswordForm({ linkInvalid }: { linkInvalid?: boolean }) {
  const [pending, setPending] = useState(false)
  const [emailError, setEmailError] = useState<string>()
  const [sent, setSent] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = forgotPasswordSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    )
    if (!parsed.success) {
      setEmailError(parsed.error.flatten().fieldErrors.email?.[0])
      return
    }
    setEmailError(undefined)
    setPending(true)
    try {
      // The origin is derived at runtime and must be in Supabase's Redirect URL
      // allow-list. With the default (PKCE) email, Supabase returns to this URL
      // with ?code=..., which /reset-password exchanges for a session. This
      // only works in the browser that requested the reset.
      const redirectTo = new URL('/reset-password', window.location.origin)
      await getSupabaseBrowserClient().auth.resetPasswordForEmail(
        parsed.data.email,
        { redirectTo: redirectTo.toString() },
      )
    } catch {
      // Deliberately ignored: the response must not reveal whether an account exists.
    } finally {
      setPending(false)
      setSent(true)
    }
  }

  const footer = (
    <Link to="/sign-in" className="font-medium text-primary underline">
      Back to sign in
    </Link>
  )

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        description="If an account exists for that email, we've sent password reset instructions."
        footer={footer}
      >
        <div className="flex items-start gap-3 rounded-lg bg-accent p-4 text-sm text-accent-foreground">
          <MailCheck className="mt-0.5 size-5 shrink-0" />
          <p>
            Open the link in the email in this same browser to choose a new
            password. It may take a minute to arrive, so check your spam folder
            too.
          </p>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Forgot your password?"
      description="Enter your email and we'll send you a link to reset it."
      footer={footer}
    >
      {linkInvalid && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>
            That reset link is invalid or has expired. Request a new one below.
          </p>
        </div>
      )}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          error={emailError}
        />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Send reset link
        </Button>
      </form>
    </AuthCard>
  )
}
