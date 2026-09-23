import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, LlmAdapter, MessageId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import * as fallbackPlugin from '../src/index.ts'

class MockAdapter extends LlmAdapter {
  calls: GenerateOptions[] = []

  constructor(
    readonly handler: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
  ) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    yield* this.handler(options)
  }
}

describe('llm-fallback plugin', () => {
  it('passes through when model succeeds without error', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    const adapter = new MockAdapter(async function* () {
      yield { type: 'text-delta', index: 0, text: 'hello' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })

    ctx.llm.registerAdapter(['provider-primary'], adapter)

    await ctx.plugin(fallbackPlugin, {
      enabled: true,
      fallbackModels: [{ provider: 'provider-secondary', model: 'fallback-model' }],
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'provider-primary', model: 'main-model', messages: [] })) {
      chunks.push(chunk)
    }

    expect(adapter.calls).toHaveLength(1)
    expect(adapter.calls[0]?.provider).toBe('provider-primary')
    expect(chunks.some(c => c.type === 'text-delta')).toBe(true)
  })

  it('switches to fallback model when primary hits rate limit (429)', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    const primaryAdapter = new MockAdapter(async function* () {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'RATE_LIMIT',
            message: 'Too Many Requests: 429 rate limit exceeded. Retry in 30s',
            providerRetryAfterMs: 30000,
          },
        },
      }
    })

    const secondaryAdapter = new MockAdapter(async function* () {
      yield { type: 'text-delta', index: 0, text: 'fallback response' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })

    ctx.llm.registerAdapter(['provider-primary'], primaryAdapter)
    ctx.llm.registerAdapter(['provider-secondary'], secondaryAdapter)

    await ctx.plugin(fallbackPlugin, {
      enabled: true,
      fallbackModels: [{ provider: 'provider-secondary', model: 'fallback-model' }],
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'provider-primary', model: 'main-model', messages: [] })) {
      chunks.push(chunk)
    }

    expect(primaryAdapter.calls).toHaveLength(1)
    expect(secondaryAdapter.calls).toHaveLength(1)
    expect(secondaryAdapter.calls[0]?.model).toBe('fallback-model')
    expect(chunks.some(c => c.type === 'text-delta' && 'text' in c && c.text === 'fallback response')).toBe(true)

    // Verify cooldown is tracked
    expect(ctx.llmFallback?.isCoolingDown('provider-primary', 'main-model')).toBe(true)

    // Subsequent request should skip primary directly while in cooldown
    primaryAdapter.calls = []
    secondaryAdapter.calls = []

    for await (const _chunk of ctx.llm.stream({ provider: 'provider-primary', model: 'main-model', messages: [] })) {
      // drain
    }

    expect(primaryAdapter.calls).toHaveLength(0)
    expect(secondaryAdapter.calls).toHaveLength(1)
  })

  it('does not catch non-rate-limit errors', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    const primaryAdapter = new MockAdapter(async function* () {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'AUTH_INVALID',
            message: 'Invalid API Key',
          },
        },
      }
    })

    const secondaryAdapter = new MockAdapter(async function* () {
      yield { type: 'text-delta', index: 0, text: 'should not be called' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })

    ctx.llm.registerAdapter(['provider-primary'], primaryAdapter)
    ctx.llm.registerAdapter(['provider-secondary'], secondaryAdapter)

    await ctx.plugin(fallbackPlugin, {
      enabled: true,
      fallbackModels: [{ provider: 'provider-secondary', model: 'fallback-model' }],
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'provider-primary', model: 'main-model', messages: [] })) {
      chunks.push(chunk)
    }

    expect(primaryAdapter.calls).toHaveLength(1)
    expect(secondaryAdapter.calls).toHaveLength(0)
    expect(chunks.some(c => c.type === 'finish' && c.reason.kind === 'error')).toBe(true)
  })

  it('buffers preamble block-start and seamlessly fails over without leaking error to downstream', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    const primaryAdapter = new MockAdapter(async function* () {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            code: 'RATE_LIMIT',
            message: '429 Quota Exceeded. Please retry in 10s',
          },
        },
      }
    })

    const secondaryAdapter = new MockAdapter(async function* () {
      yield { type: 'text-delta', index: 0, text: 'seamless fallback success' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })

    ctx.llm.registerAdapter(['provider-primary'], primaryAdapter)
    ctx.llm.registerAdapter(['provider-secondary'], secondaryAdapter)

    await ctx.plugin(fallbackPlugin, {
      enabled: true,
      fallbackModels: [{ provider: 'provider-secondary', model: 'fallback-model' }],
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'provider-primary', model: 'main-model', messages: [] })) {
      chunks.push(chunk)
    }

    expect(primaryAdapter.calls).toHaveLength(1)
    expect(secondaryAdapter.calls).toHaveLength(1)
    expect(chunks.some(c => c.type === 'text-delta' && 'text' in c && c.text === 'seamless fallback success')).toBe(true)
    expect(chunks.some(c => c.type === 'finish' && c.reason.kind === 'error')).toBe(false)
  })

  it('skips fallback candidate that yields zero chunks and tries the next', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    const primaryAdapter = new MockAdapter(async function* () {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: '429 rate limit' } },
      }
    })

    // First fallback returns an empty stream (zero chunks — simulates broken endpoint)
    const emptyFallbackAdapter = new MockAdapter(async function* () {
      // yields nothing
    })

    const finalFallbackAdapter = new MockAdapter(async function* () {
      yield { type: 'text-delta', index: 0, text: 'final fallback response' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })

    ctx.llm.registerAdapter(['provider-primary'], primaryAdapter)
    ctx.llm.registerAdapter(['provider-empty'], emptyFallbackAdapter)
    ctx.llm.registerAdapter(['provider-final'], finalFallbackAdapter)

    await ctx.plugin(fallbackPlugin, {
      enabled: true,
      fallbackModels: [
        { provider: 'provider-empty', model: 'empty-model' },
        { provider: 'provider-final', model: 'final-model' },
      ],
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'provider-primary', model: 'main-model', messages: [] })) {
      chunks.push(chunk)
    }

    expect(primaryAdapter.calls).toHaveLength(1)
    expect(emptyFallbackAdapter.calls).toHaveLength(1)
    expect(finalFallbackAdapter.calls).toHaveLength(1)
    expect(chunks.some(c => c.type === 'text-delta' && 'text' in c && c.text === 'final fallback response')).toBe(true)
    expect(chunks.some(c => c.type === 'finish' && c.reason.kind === 'error')).toBe(false)
  })

  it('skips fallback candidate that produces empty stop response and tries the next', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    const primaryAdapter = new MockAdapter(async function* () {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: '429 rate limit' } },
      }
    })

    // First fallback returns preamble only with a stop finish — empty content response
    const emptyStopAdapter = new MockAdapter(async function* () {
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 0 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })

    const finalFallbackAdapter = new MockAdapter(async function* () {
      yield { type: 'text-delta', index: 0, text: 'real response' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })

    ctx.llm.registerAdapter(['provider-primary'], primaryAdapter)
    ctx.llm.registerAdapter(['provider-empty-stop'], emptyStopAdapter)
    ctx.llm.registerAdapter(['provider-final'], finalFallbackAdapter)

    await ctx.plugin(fallbackPlugin, {
      enabled: true,
      fallbackModels: [
        { provider: 'provider-empty-stop', model: 'empty-stop-model' },
        { provider: 'provider-final', model: 'final-model' },
      ],
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'provider-primary', model: 'main-model', messages: [] })) {
      chunks.push(chunk)
    }

    expect(primaryAdapter.calls).toHaveLength(1)
    expect(emptyStopAdapter.calls).toHaveLength(1)
    expect(finalFallbackAdapter.calls).toHaveLength(1)
    expect(chunks.some(c => c.type === 'text-delta' && 'text' in c && c.text === 'real response')).toBe(true)
    expect(chunks.some(c => c.type === 'finish' && c.reason.kind === 'error')).toBe(false)
  })

  it('switches to fallback when primary model produces EMPTY_RESPONSE or zero chunks', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    const primaryAdapter = new MockAdapter(async function* () {
      // primary returns completely empty stream
    })

    const fallbackAdapter = new MockAdapter(async function* () {
      yield { type: 'text-delta', index: 0, text: 'recovered from fallback' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })

    ctx.llm.registerAdapter(['provider-primary'], primaryAdapter)
    ctx.llm.registerAdapter(['provider-fallback'], fallbackAdapter)

    await ctx.plugin(fallbackPlugin, {
      enabled: true,
      fallbackModels: [
        { provider: 'provider-fallback', model: 'fb-model' },
      ],
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'provider-primary', model: 'main-model', messages: [] })) {
      chunks.push(chunk)
    }

    expect(primaryAdapter.calls).toHaveLength(1)
    expect(fallbackAdapter.calls).toHaveLength(1)
    expect(chunks.some(c => c.type === 'text-delta' && 'text' in c && c.text === 'recovered from fallback')).toBe(true)
  })

  it('compresses/prunes context when fallback model has restricted maxContextTokens (e.g. Gemma 16k)', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    const primaryAdapter = new MockAdapter(async function* () {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: '429 rate limit' } },
      }
    })

    const fallbackAdapter = new MockAdapter(async function* () {
      yield { type: 'text-delta', index: 0, text: 'success after compression' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })

    ctx.llm.registerAdapter(['provider-primary'], primaryAdapter)
    ctx.llm.registerAdapter(['provider-gemma'], fallbackAdapter)

    await ctx.plugin(fallbackPlugin, {
      enabled: true,
      fallbackModels: [
        { provider: 'provider-gemma', model: 'gemma-4-26b-a4b-it', maxContextTokens: 5000 },
      ],
    })

    // Create 10 messages with ~1000 tokens each (~10,000 tokens total)
    const longText = 'A'.repeat(3500) // ~1000 tokens
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: MessageId(`msg-${i}`),
      role: 'user' as const,
      content: [{ type: 'text' as const, text: `Message ${i}: ${longText}` }],
      source: { kind: 'user' as const },
    }))

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({
      provider: 'provider-primary',
      model: 'main-model',
      messages,
    })) {
      chunks.push(chunk)
    }

    expect(primaryAdapter.calls).toHaveLength(1)
    expect(fallbackAdapter.calls).toHaveLength(1)
    // The fallback adapter should have received fewer messages due to pruning within 5000 budget
    const receivedMessages = fallbackAdapter.calls[0]!.messages
    expect(receivedMessages.length).toBeLessThan(messages.length)
    // First message is preserved
    const firstBlock = receivedMessages[0]?.content[0]
    expect(firstBlock?.type === 'text' && firstBlock.text.startsWith('Message 0')).toBe(true)
    expect(chunks.some(c => c.type === 'text-delta' && 'text' in c && c.text === 'success after compression')).toBe(true)
  })

  it('compresses context when primary model itself is Gemma or constrained to 16k', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    const primaryAdapter = new MockAdapter(async function* () {
      yield { type: 'text-delta', index: 0, text: 'ok' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })

    ctx.llm.registerAdapter(['provider-gemma'], primaryAdapter)

    await ctx.plugin(fallbackPlugin, {
      enabled: true,
      fallbackModels: [{ provider: 'provider-secondary', model: 'fallback-model' }],
    })

    // 10 messages of ~1000 tokens = ~10,000 tokens message content + overhead
    const longText = 'B'.repeat(7000) // ~2000 tokens
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: MessageId(`msg-${i}`),
      role: 'user' as const,
      content: [{ type: 'text' as const, text: `Message ${i}: ${longText}` }],
      source: { kind: 'user' as const },
    }))

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({
      provider: 'provider-gemma',
      model: 'gemma-4-31b-it',
      messages,
    })) {
      chunks.push(chunk)
    }

    expect(primaryAdapter.calls).toHaveLength(1)
    const passedMessages = primaryAdapter.calls[0]!.messages
    expect(passedMessages.length).toBeLessThan(messages.length)
    expect(chunks.some(c => c.type === 'text-delta')).toBe(true)
  })

  it('waits and retries when all models are rate limited', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)

    let primaryAttempts = 0
    const primaryAdapter = new MockAdapter(async function* () {
      primaryAttempts++
      if (primaryAttempts === 1) {
        yield {
          type: 'finish',
          reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: '429 rate limit. Retry in 1s', providerRetryAfterMs: 50 } },
        }
      } else {
        yield { type: 'text-delta', index: 0, text: 'unblocked after cooldown' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    })

    const secondaryAdapter = new MockAdapter(async function* () {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: '429 secondary limit. Retry in 1s', providerRetryAfterMs: 50 } },
      }
    })

    ctx.llm.registerAdapter(['provider-primary'], primaryAdapter)
    ctx.llm.registerAdapter(['provider-secondary'], secondaryAdapter)

    await ctx.plugin(fallbackPlugin, {
      enabled: true,
      fallbackModels: [{ provider: 'provider-secondary', model: 'fallback-model' }],
      defaultCooldownMs: 50,
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({
      provider: 'provider-primary',
      model: 'main-model',
      messages: [],
    })) {
      chunks.push(chunk)
    }

    // Should have retried after cooldown and succeeded
    expect(primaryAttempts).toBe(2)
    expect(chunks.some(c => c.type === 'text-delta' && 'text' in c && c.text === 'unblocked after cooldown')).toBe(true)
    // Should have notified user in reasoning
    expect(chunks.some(c => c.type === 'reasoning-delta' && 'text' in c && c.text.includes('All models currently rate-limited'))).toBe(true)
  })
})
