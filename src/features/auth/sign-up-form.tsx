import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Loader2, MailCheck } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { signUpFn } from '#/lib/auth/auth.functions'
import { signUpSchema } from '#/lib/auth/schemas'
import { AuthCard } from './auth-card'
import { FormField } from './form-field'

export function SignUpForm() {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [formError, setFormError] = useState<string>()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [confirmEmail, setConfirmEmail] = useState<string>()

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(undefined)

    const parsed = signUpSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    )
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      setFieldErrors({
        fullName: errors.fullName?.[0] ?? '',
        email: errors.email?.[0] ?? '',
        password: errors.password?.[0] ?? '',
      })
      return
    }
    setFieldErrors({})

    setPending(true)
    try {
      const result = await signUpFn({ data: parsed.data })
      if (!result.ok) {
        setFormError(result.message)
      } else if (result.needsEmailConfirmation) {
        setConfirmEmail(parsed.data.email)
      } else {
        await router.invalidate()
        await router.navigate({ to: '/dashboard' })
      }
    } catch {
      setFormError('Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  const footer = (
    <>
      Already have an account?{' '}
      <Link to="/sign-in" className="font-medium text-primary underline">
        Sign in
      </Link>
    </>
  )

  if (confirmEmail) {
    return (
      <AuthCard
        title="Check your email"
        description={`We sent a confirmation link to ${confirmEmail}.`}
        footer={footer}
      >
        <div className="flex items-start gap-3 rounded-lg bg-accent p-4 text-sm text-accent-foreground">
          <MailCheck className="mt-0.5 size-5 shrink-0" />
          <p>
            Open the link in that email to activate your account, then sign in.
          </p>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Create your account"
      description="Start organizing your research in minutes."
      footer={footer}
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormField
          id="fullName"
          label="Full name"
          autoComplete="name"
          error={fieldErrors.fullName}
        />
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
          autoComplete="new-password"
          error={fieldErrors.password}
        />
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Create account
        </Button>
      </form>
    </AuthCard>
  )
}
