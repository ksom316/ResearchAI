const serviceRoleVariable = ['SUPABASE', 'SERVICE', 'ROLE_KEY'].join('_')

export const TRUSTED_SUPABASE_VARIABLES = {
  url: 'SUPABASE_URL or VITE_SUPABASE_URL',
  serviceRoleKey: serviceRoleVariable,
} as const

export class TrustedSupabaseConfigurationError extends Error {
  readonly missingVariables: string[]

  constructor(missingVariables: string[]) {
    super('Trusted Supabase configuration is unavailable')
    this.name = 'TrustedSupabaseConfigurationError'
    this.missingVariables = missingVariables
  }
}

/** Reads server-only trusted configuration without ever exposing its values. */
export function getTrustedSupabaseConfiguration(
  env: Record<string, string | undefined> = process.env,
): { url: string; serviceRoleKey: string } {
  const url = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim()
  const serviceRoleKey = env[serviceRoleVariable]?.trim()
  const missingVariables: string[] = []
  if (!url) missingVariables.push(TRUSTED_SUPABASE_VARIABLES.url)
  if (!serviceRoleKey) {
    missingVariables.push(TRUSTED_SUPABASE_VARIABLES.serviceRoleKey)
  }
  if (!url || !serviceRoleKey) {
    throw new TrustedSupabaseConfigurationError(missingVariables)
  }
  return { url, serviceRoleKey }
}
