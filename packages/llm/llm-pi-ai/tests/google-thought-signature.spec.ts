import { describe, expect, it } from 'vitest'
import type { Api, Context as PiContext, Model } from '@earendil-works/pi-ai'
import {
  isUsableGoogleThoughtSignature,
  isValidGoogleThoughtSignature,
  repairGoogleThoughtSignatures,
  SKIP_THOUGHT_SIGNATURE_VALIDATOR,
} from '../src/google-thought-signature.ts'

interface TestPayloadPart {
  functionCall?: {
    id?: string | undefined
    name?: string | undefined
    args?: Record<string, unknown> | undefined
  } | undefined
  text?: string | undefined
  thoughtSignature?: string | undefined
  thought_signature?: string | undefined
}

interface TestPayloadContent {
  role?: string | undefined
  parts?: TestPayloadPart[] | undefined
}

interface TestPayload {
  contents?: TestPayloadContent[] | undefined
}

function mockModel(api: Api, id = 'test-model', provider = 'google'): Model<Api> {
  return {
    id,
    name: id,
    api,
    provider,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  } as Model<Api>
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

describe('google-thought-signature', () => {
  describe('isValidGoogleThoughtSignature', () => {
    it('accepts valid base64 strings with length multiple of 4', () => {
      expect(isValidGoogleThoughtSignature('AAAA')).toBe(true)
      expect(isValidGoogleThoughtSignature('YWJj')).toBe(true)
      expect(isValidGoogleThoughtSignature('YWJjZA==')).toBe(true)
      expect(isValidGoogleThoughtSignature('YWJjZGVm')).toBe(true)
    })

    it('rejects empty strings and invalid lengths', () => {
      expect(isValidGoogleThoughtSignature('')).toBe(false)
      expect(isValidGoogleThoughtSignature('A')).toBe(false)
      expect(isValidGoogleThoughtSignature('AA')).toBe(false)
      expect(isValidGoogleThoughtSignature('AAA')).toBe(false)
      expect(isValidGoogleThoughtSignature('AAAAA')).toBe(false)
    })

    it('rejects strings with non-base64 characters', () => {
      expect(isValidGoogleThoughtSignature('skip_thought_signature_validator')).toBe(false)
      expect(isValidGoogleThoughtSignature('{"id":"1234"}')).toBe(false)
      expect(isValidGoogleThoughtSignature('AA-A')).toBe(false)
      expect(isValidGoogleThoughtSignature('AA$A')).toBe(false)
    })
  })

  describe('isUsableGoogleThoughtSignature', () => {
    it('accepts the official Google bypass sentinel', () => {
      expect(isUsableGoogleThoughtSignature(SKIP_THOUGHT_SIGNATURE_VALIDATOR)).toBe(true)
    })

    it('accepts valid base64 signatures and rejects invalid ones', () => {
      expect(isUsableGoogleThoughtSignature('AAAA')).toBe(true)
      expect(isUsableGoogleThoughtSignature('invalid')).toBe(false)
      expect(isUsableGoogleThoughtSignature('')).toBe(false)
    })
  })

  describe('repairGoogleThoughtSignatures', () => {
    const googleModel = mockModel('google-generative-ai', 'gemini-3.1-flash-lite')
    const vertexModel = mockModel('google-vertex', 'gemini-3.1-flash-lite')
    const nonGoogleModel = mockModel('openai-completions', 'gpt-4o', 'openai')

    it('returns payload unchanged for non-Google models', () => {
      const payload: TestPayload = { contents: [{ role: 'model', parts: [{ functionCall: { name: 'test' } }] }] }
      const context: PiContext = { messages: [] }
      const result = repairGoogleThoughtSignatures(payload, nonGoogleModel, context)
      expect(result).toBe(payload)
      expect(payload.contents?.[0]?.parts?.[0]?.thoughtSignature).toBeUndefined()
    })

    it('returns non-object or null payload unchanged', () => {
      const context: PiContext = { messages: [] }
      expect(repairGoogleThoughtSignatures(null, googleModel, context)).toBeNull()
      expect(repairGoogleThoughtSignatures('raw string', googleModel, context)).toBe('raw string')
      expect(repairGoogleThoughtSignatures(undefined, googleModel, context)).toBeUndefined()
    })

    it('returns payload without contents array unchanged', () => {
      const context: PiContext = { messages: [] }
      const emptyPayload = {}
      const nonArrayPayload = { contents: 'invalid' }
      expect(repairGoogleThoughtSignatures(emptyPayload, googleModel, context)).toBe(emptyPayload)
      expect(repairGoogleThoughtSignatures(nonArrayPayload, googleModel, context)).toBe(nonArrayPayload)
    })

    it('restores original valid Google thought signatures by tool call ID', () => {
      const validSig = 'Cr4CCrkCCpEB'
      const context: PiContext = {
        messages: [
          {
            role: 'user',
            content: 'user question',
            timestamp: 0,
          },
          {
            role: 'assistant',
            api: 'google-generative-ai',
            provider: 'google',
            model: 'gemini-3.5-flash-lite',
            stopReason: 'toolUse',
            usage: emptyUsage(),
            timestamp: 0,
            content: [
              {
                type: 'text',
                text: 'I will read the file',
              },
              {
                type: 'toolCall',
                id: 'call-1',
                name: 'fs_read',
                arguments: { path: 'a.txt' },
                thoughtSignature: validSig,
              },
            ],
          },
        ],
      }

      const payload: TestPayload = {
        contents: [
          {
            role: 'model',
            parts: [
              {
                functionCall: {
                  id: 'call-1',
                  name: 'fs_read',
                  args: { path: 'a.txt' },
                },
              },
            ],
          },
        ],
      }

      const result = repairGoogleThoughtSignatures(payload, googleModel, context)
      expect(result).toBe(payload)
      expect(payload.contents?.[0]?.parts?.[0]?.thoughtSignature).toBe(validSig)
    })

    it('restores original thought signatures by sequential index when ID is omitted', () => {
      const validSig = 'Cr4CCrkCCpEB'
      const context: PiContext = {
        messages: [
          {
            role: 'assistant',
            api: 'google-generative-ai',
            provider: 'google',
            model: 'gemini-3.5-flash-lite',
            stopReason: 'toolUse',
            usage: emptyUsage(),
            timestamp: 0,
            content: [
              {
                type: 'toolCall',
                id: 'legacy-call-without-id',
                name: 'fs_read',
                arguments: {},
                thoughtSignature: validSig,
              },
            ],
          },
        ],
      }

      const payload: TestPayload = {
        contents: [
          {
            role: 'model',
            parts: [
              {
                functionCall: {
                  name: 'fs_read',
                  args: {},
                },
              },
            ],
          },
        ],
      }

      repairGoogleThoughtSignatures(payload, vertexModel, context)
      expect(payload.contents?.[0]?.parts?.[0]?.thoughtSignature).toBe(validSig)
    })

    it('defaults to skip_thought_signature_validator when signature is missing, invalid, or foreign', () => {
      const context: PiContext = {
        messages: [
          {
            role: 'assistant',
            api: 'openai-completions',
            provider: 'openai',
            model: 'gpt-4o',
            stopReason: 'toolUse',
            usage: emptyUsage(),
            timestamp: 0,
            content: [
              {
                type: 'toolCall',
                id: 'call-foreign',
                name: 'fs_read',
                arguments: {},
                thoughtSignature: '{"invalid":"json"}', // invalid base64
              },
              {
                type: 'toolCall',
                id: 'call-no-sig',
                name: 'fs_write',
                arguments: {},
              },
            ],
          },
        ],
      }

      const payload: TestPayload = {
        contents: [
          {
            role: 'model',
            parts: [
              {
                functionCall: {
                  id: 'call-foreign',
                  name: 'fs_read',
                },
              },
              {
                functionCall: {
                  id: 'call-no-sig',
                  name: 'fs_write',
                },
              },
              {
                functionCall: {
                  id: 'unmatched-call',
                  name: 'shell',
                },
              },
            ],
          },
        ],
      }

      repairGoogleThoughtSignatures(payload, googleModel, context)
      expect(payload.contents?.[0]?.parts?.[0]?.thoughtSignature).toBe(SKIP_THOUGHT_SIGNATURE_VALIDATOR)
      expect(payload.contents?.[0]?.parts?.[1]?.thoughtSignature).toBe(SKIP_THOUGHT_SIGNATURE_VALIDATOR)
      expect(payload.contents?.[0]?.parts?.[2]?.thoughtSignature).toBe(SKIP_THOUGHT_SIGNATURE_VALIDATOR)
    })

    it('preserves existing thoughtSignature or thought_signature on parts', () => {
      const context: PiContext = { messages: [] }
      const payload: TestPayload = {
        contents: [
          {
            role: 'model',
            parts: [
              {
                functionCall: { name: 'test1' },
                thoughtSignature: 'existing-sig',
              },
              {
                functionCall: { name: 'test2' },
                thought_signature: 'snake-sig',
              },
              {
                text: 'some regular text without functionCall',
              },
            ],
          },
          {
            role: 'user',
            parts: [
              {
                text: 'user message',
              },
            ],
          },
          {
            role: 'model',
            parts: undefined,
          },
        ],
      }

      repairGoogleThoughtSignatures(payload, googleModel, context)
      expect(payload.contents?.[0]?.parts?.[0]?.thoughtSignature).toBe('existing-sig')
      expect(payload.contents?.[0]?.parts?.[1]?.thoughtSignature).toBeUndefined()
      expect(payload.contents?.[0]?.parts?.[1]?.thought_signature).toBe('snake-sig')
    })
  })
})
