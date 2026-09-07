/**
 * Global LLM fallback service and waterfall interceptor.
 * Intercepts rate limit (429, RPM/TPM exhaustion, Quota Exceeded) errors
 * and seamlessly switches to configured fallback models across all sessions.
 *
 * @module @deepseek-ai/dsh-llm-fallback
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { LlmRuntime, GenerateOptions, StreamChunk, LlmFailure, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type { FallbackModelSpec, LlmFallbackConfig } from './types.ts'

export type { FallbackModelSpec, LlmFallbackConfig } from './types.ts'

export const name = 'llm-fallback'
export const LLM_FALLBACK_SETTINGS_NAMESPACE = 'llm-fallback'

export const FallbackModelSchema: z<FallbackModelSpec> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
}) as unknown as z<FallbackModelSpec>

export const Config: z<LlmFallbackConfig> = z.object({
  enabled: z.boolean().default(true),
  fallbackModels: z.array(FallbackModelSchema).default([]),
  defaultCooldownMs: z.number().default(60_000),
})

/**
 * Service providing model cooldown state and programmatic fallback control.
 */
export class LlmFallbackService {
  /** Cooldown expiration timestamp keyed by "provider/model". */
  readonly modelCooldowns = new Map<string, number>()

  constructor(readonly ctx: Context, public config: LlmFallbackConfig) {}

  /**
   * Set cooldown duration for a model.
   */
  setCooldown(provider: string, model: string, durationMs: number): void {
    const key = `${provider}/${model}`
    this.modelCooldowns.set(key, Date.now() + durationMs)
  }

  /**
   * Check whether a model is currently in cooldown.
   */
  isCoolingDown(provider: string, model: string): boolean {
    const key = `${provider}/${model}`
    const expiry = this.modelCooldowns.get(key)
    if (!expiry) return false
    if (Date.now() >= expiry) {
      this.modelCooldowns.delete(key)
      return false
    }
    return true
  }

  /**
   * Clear all active cooldowns.
   */
  clearCooldowns(): void {
    this.modelCooldowns.clear()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    llmFallback?: LlmFallbackService
  }
}

/**
 * Helper to extract rate limit retry delay from error/failure.
 */
function extractRetryDelayMs(error: unknown, defaultMs: number): number {
  if (!error || typeof error !== 'object') return defaultMs

  const errObj = error as Record<string, unknown>

  if (typeof errObj.providerRetryAfterMs === 'number' && errObj.providerRetryAfterMs > 0) {
    return errObj.providerRetryAfterMs
  }
  if (typeof errObj.retryAfter === 'number' && errObj.retryAfter > 0) {
    return errObj.retryAfter * 1000
  }

  const msg = String(errObj.message || error)
  const match = /(?:please retry in|retry in|retry after|resets in)\s*(\d+(?:\.\d+)?)\s*s\b/i.exec(msg)
    ?? /"retryDelay":\s*"(\d+(?:\.\d+)?)s?"/i.exec(msg)
    ?? /retry-after:\s*(\d+)/i.exec(msg)

  if (match?.[1]) {
    const seconds = parseFloat(match[1])
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000)
    }
  }

  return defaultMs
}

/**
 * Helper to test if failure is a rate-limit or quota-exceeded error.
 */
function isRateLimitError(code: string | undefined, message: string): boolean {
  if (code === 'RATE_LIMIT' || code === 'QUOTA_EXCEEDED') return true
  return /\b429\b|rate.?limit|quota|resource.?exhausted|too many requests/i.test(message)
}

const FALLBACK_IN_PROGRESS = Symbol('llmFallbackInProgress')

interface GuardedOptions extends GenerateOptions {
  [FALLBACK_IN_PROGRESS]?: boolean
}

export function apply(ctx: Context, initialConfig: LlmFallbackConfig = {}): void {
  const service = new LlmFallbackService(ctx, { ...initialConfig })
  ctx.provide('llmFallback', service)

  // Integrate with settings file / hot reload
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(
      ctx,
      LLM_FALLBACK_SETTINGS_NAMESPACE,
      Config,
      initialConfig,
      {
        setSource: (source) => {
          service.config = source()
        },
        onChange: () => {},
      },
    )
  })

  // Register waterfall on llm/stream
  ctx.on('llm/stream', async function* (options, next) {
    const self = this as LlmRuntime
    const config = service.config
    const guarded = options as GuardedOptions

    // If this call is already a fallback sub-call or plugin is disabled, pass directly to next
    if (guarded[FALLBACK_IN_PROGRESS]
      || config.enabled === false
      || !config.fallbackModels
      || config.fallbackModels.length === 0) {
      yield* next()
      return
    }

    // Full candidate chain: requested model first, followed by configured fallback models
    const chain: Array<{ provider: string; model: string; reasoningEffort?: string | undefined }> = [
      {
        provider: options.provider,
        model: options.model,
        ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      },
      ...config.fallbackModels.map(f => ({
        provider: f.provider,
        model: f.model,
        ...(f.reasoningEffort !== undefined ? { reasoningEffort: f.reasoningEffort } : {}),
      })),
    ]

    // Prioritize candidates not currently in cooldown
    const now = Date.now()
    const activeCandidates = chain.filter((c) => {
      const expiry = service.modelCooldowns.get(`${c.provider}/${c.model}`) ?? 0
      return now >= expiry
    })

    const candidates = activeCandidates.length > 0 ? activeCandidates : chain

    let lastFailure: LlmFailure | null = null

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]
      if (!candidate) continue
      const isFirst = i === 0
      const isOriginalModel = candidate.provider === options.provider && candidate.model === options.model

      let chunkCount = 0
      let rateLimitError = false
      let terminalError: LlmFailure | null = null

      try {
        let streamIterable: AsyncIterable<StreamChunk>
        if (isFirst && isOriginalModel) {
          // If the first candidate is the original requested model, call next() to let downstream run
          streamIterable = next()
        } else {
          // Fallback or rerouted candidate: invoke self.stream with recursive guard flag
          const reqOptions: GuardedOptions = {
            ...options,
            provider: candidate.provider,
            model: candidate.model,
            ...(candidate.reasoningEffort ? { reasoningEffort: candidate.reasoningEffort as ReasoningEffortId } : {}),
            [FALLBACK_IN_PROGRESS]: true,
          }
          streamIterable = self.stream(reqOptions)
        }

        for await (const chunk of streamIterable) {
          chunkCount++
          if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
            const failure = chunk.reason.failure
            const code = failure?.code
            const msg = failure?.message || ''
            if (isRateLimitError(code, msg)) {
              rateLimitError = true
              terminalError = failure
              break
            }
          }
          yield chunk
        }
      } catch (err: unknown) {
        const errObj = err as Record<string, unknown>
        const errMsg = String(errObj?.message || err)
        const code = typeof errObj?.code === 'string' ? errObj.code : undefined
        if (isRateLimitError(code, errMsg)) {
          rateLimitError = true
          terminalError = {
            code: code ?? 'RATE_LIMIT',
            message: errMsg,
          }
        } else {
          throw err
        }
      }

      if (rateLimitError) {
        const retryDelayMs = extractRetryDelayMs(terminalError, config.defaultCooldownMs ?? 60_000)
        const retrySeconds = Math.round(retryDelayMs / 1000)
        ctx.logger.warn(
          `[llm-fallback] Model ${candidate.provider}/${candidate.model} hit rate limit. Setting ${retrySeconds}s cooldown.`,
        )

        service.setCooldown(candidate.provider, candidate.model, retryDelayMs)
        lastFailure = terminalError

        // If no substantial chunks were sent and another candidate exists, switch seamlessly
        if (i + 1 < candidates.length && chunkCount <= 1) {
          const nextModel = candidates[i + 1]
          if (nextModel) {
            ctx.logger.info(
              `[llm-fallback] Seamlessly switching to fallback model: ${nextModel.provider}/${nextModel.model}`,
            )
            continue
          }
        }
      }

      return
    }

    if (lastFailure) {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: lastFailure },
      }
    }
  })
}
