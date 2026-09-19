import type { ComponentProps } from 'react'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

export function FormField({
  id,
  label,
  error,
  ...props
}: ComponentProps<typeof Input> & {
  id: string
  label: string
  error?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} aria-invalid={!!error} {...props} />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
