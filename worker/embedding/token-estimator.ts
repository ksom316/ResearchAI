/**
 * Conservative token estimator for pacing.
 *
 * A real tokenizer would be a large dependency and Voyage's exact counts are only
 * known AFTER a request (usage.total_tokens). So we estimate from character count,
 * deliberately pessimistically, and learn from the billed tokens the provider
 * reports:
 *
 *  - It starts at 3 characters per token. English prose is usually 4+, but
 *    math-heavy or code-like text can be ~2.5, and under-estimating would push the
 *    account past its tokens-per-minute limit.
 *  - After each response it blends in the observed characters/token, with a 10%
 *    safety margin, clamped to [2.5, 4.0]. It can therefore get a little less
 *    pessimistic for ordinary text but never optimistic.
 *
 * The tradeoff: estimates may be up to ~30% high, which slows indexing slightly in
 * exchange for staying under the limit without extra dependencies.
 */
export type TokenEstimatorOptions = {
  initialCharsPerToken?: number
  minCharsPerToken?: number
  maxCharsPerToken?: number
  /** Multiplier applied to the observed ratio (<1 keeps it pessimistic). */
  safetyFactor?: number
  /** Weight of the newest observation in the moving average. */
  alpha?: number
}

export class TokenEstimator {
  private readonly min: number
  private readonly max: number
  private readonly safety: number
  private readonly alpha: number
  private observedRatio: number | null = null
  private current: number

  constructor(options: TokenEstimatorOptions = {}) {
    this.min = options.minCharsPerToken ?? 2.5
    this.max = options.maxCharsPerToken ?? 4
    this.safety = options.safetyFactor ?? 0.9
    this.alpha = options.alpha ?? 0.3
    this.current = clamp(options.initialCharsPerToken ?? 3, this.min, this.max)
  }

  get charsPerToken(): number {
    return this.current
  }

  /** Estimated tokens for `chars` characters (always rounded up). */
  estimate(chars: number): number {
    return Math.ceil(chars / this.current)
  }

  /** Feed back a provider-reported token count for a request of `chars` characters. */
  observe(chars: number, billedTokens: number | null): void {
    if (billedTokens === null || billedTokens <= 0 || chars <= 0) return
    const ratio = chars / billedTokens
    this.observedRatio =
      this.observedRatio === null
        ? ratio
        : this.alpha * ratio + (1 - this.alpha) * this.observedRatio
    this.current = clamp(this.observedRatio * this.safety, this.min, this.max)
  }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))
