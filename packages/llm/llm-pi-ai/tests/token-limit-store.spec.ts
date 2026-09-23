import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { defaultTokenLimitsPath, loadTokenLimitsSync, parseTokenLimits, saveTokenLimits, TokenLimitStore } from '../src/token-limit-store.ts'
import { memoryAuth } from './auth-double.ts'

describe('token-limit-store', () => {
  let tempDir: string
  let limitsFile: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'token-limits-test-'))
    limitsFile = join(tempDir, 'token-limits.json')
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('resolves defaultTokenLimitsPath under harness home', () => {
    const defaultPath = defaultTokenLimitsPath()
    expect(defaultPath).toContain('token-limits.json')
    expect(defaultPath).toContain('llm-pi-ai')
  })

  it('returns empty map when file does not exist', () => {
    const store = new TokenLimitStore({ path: limitsFile })
    expect(store.load().size).toBe(0)
    expect(loadTokenLimitsSync(limitsFile).size).toBe(0)
  })

  it('persists and loads token limits from disk', async () => {
    const store = new TokenLimitStore({ path: limitsFile })
    const limits = new Map<string, number>([
      ['google/gemini-3.5-flash-lite', 250000],
      ['google/gemini-2.5-flash', 500000],
    ])

    await store.save(limits)

    const reloaded = store.load()
    expect(reloaded.get('google/gemini-3.5-flash-lite')).toBe(250000)
    expect(reloaded.get('google/gemini-2.5-flash')).toBe(500000)

    const raw = JSON.parse(readFileSync(limitsFile, 'utf8')) as {
      formatVersion: number
      limits: Record<string, number>
    }
    expect(raw.formatVersion).toBe(1)
    expect(raw.limits['google/gemini-3.5-flash-lite']).toBe(250000)
  })

  it('safely handles corrupted or invalid JSON without throwing', () => {
    writeFileSync(limitsFile, '{ corrupted json...', 'utf8')
    const store = new TokenLimitStore({ path: limitsFile })
    expect(store.load().size).toBe(0)

    writeFileSync(limitsFile, JSON.stringify({ formatVersion: 999, limits: {} }), 'utf8')
    expect(store.load().size).toBe(0)

    writeFileSync(limitsFile, JSON.stringify({ formatVersion: 1, limits: 'not-an-object' }), 'utf8')
    expect(store.load().size).toBe(0)

    expect(parseTokenLimits('not valid')).toBeUndefined()
  })

  it('filters out non-positive or non-safe integer limits', () => {
    const json = JSON.stringify({
      formatVersion: 1,
      limits: {
        'valid/model': 250000,
        'invalid/neg': -100,
        'invalid/zero': 0,
        'invalid/str': '250000',
        'invalid/float': 123.456,
      },
    })
    const parsed = parseTokenLimits(json)
    expect(parsed?.size).toBe(1)
    expect(parsed?.get('valid/model')).toBe(250000)
  })

  it('disables persistence when path is false', async () => {
    const store = new TokenLimitStore({ path: false })
    expect(store.path).toBeUndefined()
    expect(store.load().size).toBe(0)

    await store.save(new Map([['provider/model', 1000]]))
    expect(store.load().size).toBe(0)
  })

  it('PiAiAdapter immediately uses pre-existing token limits from disk', async () => {
    await saveTokenLimits(
      limitsFile,
      new Map([['google/gemini-3.5-flash-lite', 250000]]),
    )

    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ google: { apiKeyEnv: 'GOOGLE_API_KEY' } }),
      resolveApiKey: () => Promise.resolve('test-key'),
      auth: memoryAuth(),
      tokenLimitsPath: limitsFile,
    })

    const prepared = await adapter.prepareCall('google', 'gemini-3.5-flash-lite')
    expect(prepared.model.context?.contextWindow).toBe(250000)

    const resolved = await adapter.resolveModel('google', 'gemini-3.5-flash-lite')
    expect(resolved.context?.contextWindow).toBe(250000)
  })
})
