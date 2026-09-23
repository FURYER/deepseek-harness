/**
 * Global LLM fallback service and waterfall interceptor.
 * Intercepts rate limit (429, RPM/TPM exhaustion, Quota Exceeded) errors
 * and seamlessly switches to configured fallback models across all sessions.
 *
 * @module @deepseek-ai/dsh-llm-fallback
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { EMPTY_RESPONSE_CODE, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime, GenerateOptions, StreamChunk, LlmFailure } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type { FallbackModelSpec, LlmFallbackConfig } from './types.ts'

export type { FallbackModelSpec, LlmFallbackConfig } from './types.ts'

export const name = 'llm-fallback'
export const LLM_FALLBACK_SETTINGS_NAMESPACE = 'llm-fallback'

export const FallbackModelSchema: z<FallbackModelSpec> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
  maxContextTokens: z.number().step(1).min(100),
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

/**
 * Rough token estimation: 1 token ~ 3.5 characters (safe conservative bound for multilingual/code).
 */
function estimateMessageTokens(msg: GenerateOptions['messages'][number]): number {
  let chars = 20 // overhead
  for (const block of msg.content) {
    if (block.type === 'text') chars += block.text.length
    else if (block.type === 'reasoning') chars += block.text.length
    else if (block.type === 'tool-call') chars += block.arguments.length + block.name.length
    else if (block.type === 'tool-result') {
      for (const b of block.content) {
        if (b.type === 'text') chars += b.text.length
      }
    }
  }
  return Math.ceil(chars / 3.5)
}

/**
 * Estimate total input tokens of GenerateOptions (system prompt, tools, messages).
 */
function estimateTotalTokens(options: GenerateOptions): number {
  let tokens = 0
  if (options.system) tokens += Math.ceil(options.system.length / 3.5)
  if (options.tools) {
    for (const tool of options.tools) {
      tokens += Math.ceil((tool.name.length + tool.description.length + JSON.stringify(tool.parameters).length) / 3.5)
    }
  }
  for (const msg of options.messages) {
    tokens += estimateMessageTokens(msg)
  }
  return tokens
}

/**
 * Prune or truncate messages to fit within a target token limit (e.g. 16,000 for Gemma free tier).
 * Keeps recent conversation turns and truncates oversized tool results or older messages.
 */
export function pruneMessagesToTokenBudget(
  options: GenerateOptions,
  maxBudget: number,
): GenerateOptions['messages'] {
  const messages = options.messages
  if (messages.length === 0) return messages

  // Fixed overhead: system prompt + tools
  let fixedTokens = 0
  if (options.system) fixedTokens += Math.ceil(options.system.length / 3.5)
  if (options.tools) {
    for (const tool of options.tools) {
      fixedTokens += Math.ceil((tool.name.length + tool.description.length + JSON.stringify(tool.parameters).length) / 3.5)
    }
  }

  // For tight context models (like Gemma with 16k window), reserve 4,000-5,000 tokens for output generation
  // and estimation variance so input context is squeezed down to 10,000 - 12,000 tokens max.
  const outputReserve = maxBudget <= 20_000 ? 5_000 : 1_000
  const targetMessageTokens = Math.max(1000, maxBudget - fixedTokens - outputReserve)

  // Pass 1: truncate large tool results in message copies
  const sanitized = messages.map((m) => {
    let modified = false
    const content = m.content.map((block) => {
      if (block.type === 'tool-result') {
        const prunedSubBlocks = block.content.map((b) => {
          if (b.type === 'text' && b.text.length > 2000) {
            modified = true
            return {
              ...b,
              text: `${b.text.slice(0, 1000)}\n\n[... truncated for context limit ...]\n\n${b.text.slice(-500)}`,
            }
          }
          return b
        })
        if (modified) {
          return { ...block, content: prunedSubBlocks }
        }
      }
      return block
    })
    return modified ? { ...m, content } : m
  })

  // Measure sanitized messages
  const msgTokens = sanitized.map(estimateMessageTokens)
  const total = msgTokens.reduce((a, b) => a + b, 0)

  if (total <= targetMessageTokens) {
    return sanitized
  }

  // Pass 2: Keep the initial user instruction (message 0) and the most recent messages from the end
  const firstMsg = sanitized[0]
  if (!firstMsg) return sanitized

  const firstTokens = msgTokens[0] ?? 0
  let budgetRemaining = targetMessageTokens - firstTokens
  const keptIndices: number[] = [0]

  for (let i = sanitized.length - 1; i >= 1; i--) {
    const cost = msgTokens[i] ?? 0
    if (budgetRemaining - cost < 0 && keptIndices.length > 1) {
      break
    }
    budgetRemaining -= cost
    keptIndices.push(i)
  }

  keptIndices.sort((a, b) => a - b)
  return keptIndices.map(i => sanitized[i]).filter((m): m is NonNullable<typeof m> => m !== undefined)
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
    const chain: Array<{
      provider: string
      model: string
      reasoningEffort?: string | undefined
      maxContextTokens?: number | undefined
    }> = [
      {
        provider: options.provider,
        model: options.model,
        ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
      },
      ...config.fallbackModels.map(f => ({
        provider: f.provider,
        model: f.model,
        ...(f.reasoningEffort !== undefined ? { reasoningEffort: f.reasoningEffort } : {}),
        ...(f.maxContextTokens !== undefined ? { maxContextTokens: f.maxContextTokens } : {}),
      })),
    ]

    let lastFailure: LlmFailure | null = null
    const MAX_EXHAUSTION_RETRIES = 5

    // Order of reasoning effort escalation from highest to lowest
    const EFFORT_HIERARCHY: readonly ReasoningEffortId[] = [
      ReasoningEffortId('max'),
      ReasoningEffortId('xhigh'),
      ReasoningEffortId('high'),
      ReasoningEffortId('medium'),
      ReasoningEffortId('low'),
      ReasoningEffortId('minimal'),
    ]

    for (let retryRound = 0; retryRound < MAX_EXHAUSTION_RETRIES; retryRound++) {
      const candidates = chain

      let allCandidatesRateLimited = true

      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i]
        if (!candidate) continue

        // If this candidate is currently in cooldown, treat it as rate limited and move to next
        if (service.isCoolingDown(candidate.provider, candidate.model)) {
          continue
        }

        const isFirst = i === 0 && retryRound === 0
        const isOriginalModel = candidate.provider === options.provider && candidate.model === options.model

        let rateLimitError = false
        let fatalModelError = false
        let terminalError: LlmFailure | null = null

        try {
          let candidateContextWindow: number | undefined = candidate.maxContextTokens
          if (candidateContextWindow === undefined && /gemma/i.test(candidate.model)) {
            candidateContextWindow = 16_000
          }

          let streamIterable: AsyncIterable<StreamChunk>
          const estimated = estimateTotalTokens(options)
          const needsCompression = candidateContextWindow !== undefined && estimated > candidateContextWindow

          if (isFirst && isOriginalModel && !needsCompression) {
            // Normal pass-through to downstream next() when no compression needed
            streamIterable = next()
          } else {
            // Fallback or rerouted candidate: determine supported reasoning effort
            let chosenEffort: ReasoningEffortId | undefined = candidate.reasoningEffort as ReasoningEffortId | undefined

            if (!isOriginalModel) {
              try {
                const modelInfo = await self.resolveModelInfo(candidate.provider, candidate.model)
                const supported = modelInfo.reasoning?.efforts.map(e => e.id)
                if (supported && supported.length > 0) {
                  if (chosenEffort && supported.includes(chosenEffort)) {
                    // Configured effort is supported as-is
                  } else {
                    // Find the highest available effort level
                    chosenEffort = EFFORT_HIERARCHY.find(e => supported.includes(e)) ?? supported[0]
                  }
                } else {
                  // Model does not support reasoning effort configuration
                  chosenEffort = undefined
                }

                if (candidateContextWindow === undefined && modelInfo.context?.contextWindow) {
                  candidateContextWindow = modelInfo.context.contextWindow
                }
              } catch {
                // If model inspection fails, drop the effort override so it doesn't cause UNSUPPORTED_REASONING_EFFORT
                chosenEffort = undefined
              }
            }

            // Compress/prune context if candidate has a restricted token capacity and current messages exceed it
            let effectiveMessages = options.messages
            if (candidateContextWindow !== undefined) {
              const estimated = estimateTotalTokens(options)
              if (estimated > candidateContextWindow) {
                ctx.logger.info(
                  `[llm-fallback] Context estimated at ~${estimated} tokens exceeds candidate ${candidate.provider}/${candidate.model} limit (${candidateContextWindow}). Compressing context...`,
                )
                effectiveMessages = pruneMessagesToTokenBudget(options, candidateContextWindow)
              }
            }

            // Invoke self.stream with recursive guard flag
            const reqOptions: GuardedOptions = {
              ...options,
              provider: candidate.provider,
              model: candidate.model,
              messages: effectiveMessages,
              ...(chosenEffort ? { reasoningEffort: chosenEffort } : {}),
              [FALLBACK_IN_PROGRESS]: true,
            }
            if (!chosenEffort) {
              delete (reqOptions as { reasoningEffort?: unknown }).reasoningEffort
            }
            streamIterable = self.stream(reqOptions)
          }

          let hasUserVisibleOutput = false
          const bufferedPreamble: StreamChunk[] = []

          for await (const chunk of streamIterable) {
            if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
              const failure = chunk.reason.failure
              const code = failure?.code
              const msg = failure?.message || ''
              if (isRateLimitError(code, msg)) {
                rateLimitError = true
                terminalError = failure
                break
              } else if (code === EMPTY_RESPONSE_CODE) {
                // The model returned a stop finish with zero content blocks
                ctx.logger.warn(
                  `[llm-fallback] Model ${candidate.provider}/${candidate.model} produced EMPTY_RESPONSE (no content). Trying fallback.`,
                )
                fatalModelError = true
                terminalError = failure
                break
              } else if (!isOriginalModel && !hasUserVisibleOutput) {
                // Fatal model configuration error on a fallback candidate before any output was emitted
                fatalModelError = true
                terminalError = failure
                break
              }
            }

            if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta') {
              hasUserVisibleOutput = true
            }

            if (!hasUserVisibleOutput) {
              // Buffer block-start or usage until we know generation actually started
              bufferedPreamble.push(chunk)
            } else {
              // Flush buffered preamble first
              if (bufferedPreamble.length > 0) {
                for (const buffered of bufferedPreamble) {
                  yield buffered
                }
                bufferedPreamble.length = 0
              }
              yield chunk
            }
          }

          // After the stream, check whether to flush the buffered preamble or skip this candidate.
          if (!rateLimitError && !fatalModelError) {
            if (bufferedPreamble.length === 0 && !hasUserVisibleOutput) {
              // Completely empty stream — the candidate yielded nothing at all (no preamble, no finish).
              ctx.logger.warn(
                `[llm-fallback] Candidate ${candidate.provider}/${candidate.model} returned an empty stream (zero chunks). Trying next candidate.`,
              )
              fatalModelError = true
              terminalError = {
                code: 'EMPTY_STREAM',
                message: `${candidate.provider}/${candidate.model} returned an empty stream`,
              }
            } else if (!hasUserVisibleOutput) {
              // Preamble-only stream: the model terminated without emitting any content or tool-call deltas.
              const finishChunk = bufferedPreamble.find(
                (c): c is Extract<StreamChunk, { type: 'finish' }> => c.type === 'finish',
              )
              const finishKind = finishChunk?.reason.kind ?? 'stop'
              if (finishKind === 'stop' || finishKind === 'tool-calls' || finishKind === 'max-tokens') {
                ctx.logger.warn(
                  `[llm-fallback] Candidate ${candidate.provider}/${candidate.model} produced an empty ${finishKind} response (no content). Trying next candidate.`,
                )
                fatalModelError = true
                terminalError = {
                  code: 'EMPTY_STREAM',
                  message: `${candidate.provider}/${candidate.model} produced an empty ${finishKind} response`,
                }
              } else {
                // Other non-stop finish with preamble only: pass through.
                for (const buffered of bufferedPreamble) {
                  yield buffered
                }
                bufferedPreamble.length = 0
              }
            } else if (bufferedPreamble.length > 0) {
              // Normal case: generation started — flush the buffered preamble.
              for (const buffered of bufferedPreamble) {
                yield buffered
              }
              bufferedPreamble.length = 0
            }
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
          } else if (!isOriginalModel && i + 1 < candidates.length) {
            // If a fallback candidate failed during call initialization/streaming before output,
            // record and continue to next fallback candidate
            ctx.logger.warn(
              `[llm-fallback] Candidate ${candidate.provider}/${candidate.model} failed with error (${code ?? 'UNKNOWN'}): ${errMsg}. Trying next candidate.`,
            )
            fatalModelError = true
            terminalError = {
              code: code ?? 'MODEL_ERROR',
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

          // Search for the next candidate that is not in cooldown
          const nextCandidate = candidates.slice(i + 1).find(c => !service.isCoolingDown(c.provider, c.model))
          if (nextCandidate) {
            ctx.logger.info(
              `[llm-fallback] Seamlessly switching to fallback model: ${nextCandidate.provider}/${nextCandidate.model}`,
            )
            yield {
              type: 'reasoning-delta',
              index: 0,
              text: `> ⚠️ **Rate limit hit on \`${candidate.provider}/${candidate.model}\`** (${retrySeconds}s cooldown). Switching to fallback model: **\`${nextCandidate.provider}/${nextCandidate.model}\`**...\n\n`,
            }
            continue
          }
          break
        } else if (fatalModelError) {
          allCandidatesRateLimited = false
          lastFailure = terminalError
          const nextCandidate = candidates.slice(i + 1).find(c => !service.isCoolingDown(c.provider, c.model))
          if (nextCandidate) {
            ctx.logger.warn(
              `[llm-fallback] Switching to next fallback model after error on ${candidate.provider}/${candidate.model}: ${nextCandidate.provider}/${nextCandidate.model}`,
            )
            continue
          }
          break
        }

        // Successfully generated output
        return
      }

      // If candidates were exhausted because of rate limits, wait for the earliest cooldown to expire
      if (allCandidatesRateLimited && retryRound + 1 < MAX_EXHAUSTION_RETRIES) {
        let minExpiry = Infinity
        let earliestCandidate = ''
        for (const c of chain) {
          const key = `${c.provider}/${c.model}`
          const exp = service.modelCooldowns.get(key)
          if (exp && exp < minExpiry) {
            minExpiry = exp
            earliestCandidate = key
          }
        }

        const currentTime = Date.now()
        const waitMs = minExpiry !== Infinity && minExpiry > currentTime
          ? Math.min(60_000, Math.max(1_000, minExpiry - currentTime + 500))
          : Math.min(60_000, config.defaultCooldownMs ?? 15_000)

        const waitSeconds = Math.ceil(waitMs / 1000)
        ctx.logger.warn(
          `[llm-fallback] All candidate models are rate-limited. Waiting ${waitSeconds}s for ${earliestCandidate || 'cooldown'} before retrying...`,
        )

        yield {
          type: 'reasoning-delta',
          index: 0,
          text: `> ⏳ **All models currently rate-limited.** Waiting **${waitSeconds}s** for \`${earliestCandidate || 'cooldown'}\` to roll off before retrying...\n\n`,
        }

        await new Promise(resolve => setTimeout(resolve, waitMs))
        continue
      }

      break
    }

    if (lastFailure) {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: lastFailure },
      }
    }
  })
}
