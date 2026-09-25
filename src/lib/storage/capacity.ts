/** Per-file safety limit. Account capacity is authoritative in Supabase config. */
export const MAX_INDIVIDUAL_PDF_BYTES = 50 * 1024 * 1024
export const BYTES_PER_MB = 1024 * 1024

export function wholeMegabytes(bytes: number): number {
  return Math.max(0, Math.ceil(bytes / BYTES_PER_MB))
}
