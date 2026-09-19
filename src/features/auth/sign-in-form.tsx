import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { signInFn } from '#/lib/auth/auth.functions'
import { safeRedirect } from '#/lib/auth/redirect'
import { signInSchema } from '#/lib/auth/schemas'
import { AuthCard } from './auth-card'
import { FormField } from './form-field'
import { GoogleButton } from './google-button'

const OAUTH_ERRORS: Record<string, string> = {
  oauth_cancelled: 'Google sign-in was cancelled.',
  oauth_failed: 'We couldn’t sign you in with Google. Please try again.',
}

export function SignInForm({
  redirectTo,
  error,
}: {
  redirectTo?: string
  error?: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string | undefined>(
    error ? OAUTH_ERRORS[error] : undefined,
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(undefined)

    const parsed = signInSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    )
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      setFieldErrors({
        email: errors.email?.[0] ?? '',
        password: errors.password?.[0] ?? '',
      })
      return
    }
    setFieldErrors({})

    setPending(true)
    try {
      const result = await signInFn({ data: parsed.data })
      if (!result.ok) {
        setFormError(result.message)
        return
      }
      await router.invalidate()
      await router.navigate({ to: safeRedirect(redirectTo) })
    } catch {
      setFormError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to your research workspace."
      footer={
        <>
          New to ResearchAI?{' '}
          <Link to="/sign-up" className="font-medium text-primary underline">
            Create an account
          </Link>
        </>
      }
    >
      <GoogleButton
        redirectTo={redirectTo ? safeRedirect(redirectTo) : undefined}
      />
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          error={fieldErrors.email}
        />
        <FormField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          error={fieldErrors.password}
        />
        <div className="-mt-2 text-right text-sm">
          <Link
            to="/forgot-password"
            className="font-medium text-primary underline"
          >
            Forgot password?
          </Link>
        </div>
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Sign in
        </Button>
      </form>
    </AuthCard>
  )
}
