import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { updatePasswordFn } from '#/lib/auth/auth.functions'
import { resetPasswordSchema } from '#/lib/auth/schemas'
import { AuthCard } from './auth-card'
import { FormField } from './form-field'

const backToSignIn = (
  <Link to="/sign-in" className="font-medium text-primary underline">
    Back to sign in
  </Link>
)

export function ResetPasswordForm() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string>()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [done, setDone] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(undefined)

    const parsed = resetPasswordSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    )
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      setFieldErrors({
        password: errors.password?.[0] ?? '',
        confirmPassword: errors.confirmPassword?.[0] ?? '',
      })
      return
    }
    setFieldErrors({})

    setPending(true)
    try {
      const result = await updatePasswordFn({ data: parsed.data })
      if (!result.ok) {
        setFormError(result.message)
        return
      }
      await router.invalidate()
      setDone(true)
    } catch {
      setFormError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  if (done) {
    return (
      <AuthCard
        title="Password updated"
        description="You're signed in with your new password."
        footer={backToSignIn}
      >
        <div className="flex items-start gap-3 rounded-lg bg-accent p-4 text-sm text-accent-foreground">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
          <p>Your password has been changed successfully.</p>
        </div>
        <Button asChild className="w-full">
          <Link to="/dashboard">Continue to ResearchAI</Link>
        </Button>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Use at least 8 characters."
      footer={backToSignIn}
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          error={fieldErrors.password}
        />
        <FormField
          id="confirmPassword"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={fieldErrors.confirmPassword}
        />
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}{' '}
            {formError.includes('expired') && (
              <Link
                to="/forgot-password"
                className="font-medium text-primary underline"
              >
                Request a new link
              </Link>
            )}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Update password
        </Button>
      </form>
    </AuthCard>
  )
}
