import { z } from 'zod'

export const signInSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(100),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters').max(72),
})

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
})

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters').max(72),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

export type SignInInput = z.infer<typeof signInSchema>
export type SignUpInput = z.infer<typeof signUpSchema>
