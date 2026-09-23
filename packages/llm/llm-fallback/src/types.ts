/**
 * Configuration and models for the global LLM fallback service.
 */

export interface FallbackModelSpec {
  /** Target provider route key, e.g. "pi-ai" or "deepseek-official". */
  provider: string
  /** Model identifier accepted by the provider. */
  model: string
  /** Optional reasoning effort override for the fallback model. */
  reasoningEffort?: string | undefined
  /**
   * Optional maximum context token limit for this fallback candidate (e.g. 16000 for Gemma free tier).
   * If messages exceed this limit, history will be dynamically pruned to fit within this budget.
   */
  maxContextTokens?: number | undefined
}

export interface LlmFallbackConfig {
  /** Whether the global fallback waterfall is enabled (default: true). */
  enabled?: boolean
  /** Ordered list of fallback models to switch to on rate-limit / quota errors. */
  fallbackModels?: FallbackModelSpec[]
  /** Default cooldown in milliseconds if provider doesn't report retry-after (default: 60000). */
  defaultCooldownMs?: number
}
