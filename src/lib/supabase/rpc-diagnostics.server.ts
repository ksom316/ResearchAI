export type SupabaseRpcError = {
  code?: string
  message: string
}

const SAFE_DATABASE_MESSAGES = [
  /^(?:search|storage|authentication)_[a-z_]+$/i,
  /^column reference "[a-z_]+" is ambiguous$/i,
  /^permission denied for function [a-z_]+$/i,
  /^function [a-z0-9_.(,) ]+ does not exist$/i,
]

export function safeSupabaseErrorMessage(message: string): string {
  const normalized = message.trim().replace(/\s+/g, ' ')
  return SAFE_DATABASE_MESSAGES.some((pattern) => pattern.test(normalized))
    ? normalized
    : 'Database request failed'
}

export function logSupabaseRpcError(input: {
  operation: string
  rpc: string
  error: SupabaseRpcError
}): void {
  console.error('[supabase-rpc]', {
    operation: input.operation,
    rpc: input.rpc,
    code: input.error.code ?? 'unknown',
    message: safeSupabaseErrorMessage(input.error.message),
  })
}
