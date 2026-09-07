import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
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
})
