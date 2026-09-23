/**
 * Restoration and fallback for Google Gemini thought signatures on historical function calls.
 *
 * Google Gemini 2.5 and 3.x require any historical `functionCall` part in a
 * model turn to include a `thought_signature`. When pi-ai transforms messages
 * across models (such as during fallback or cross-model chat), it strips
 * `thoughtSignature` from `toolCall` blocks. This module restores original
 * signatures when available in context, or applies Google's official bypass
 * sentinel (`skip_thought_signature_validator`).
 *
 * @module dsh-llm-pi-ai/google-thought-signature
 */

import type { Api, Context as PiContext, Model } from '@earendil-works/pi-ai'

/**
 * Sentinel value recognized by the Google Gemini API to bypass thought signature
 * validation on historical function calls.
 */
export const SKIP_THOUGHT_SIGNATURE_VALIDATOR = 'skip_thought_signature_validator'

const BASE64_SIGNATURE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * Validate whether a string conforms to base64 encoding rules for Google thought signatures.
 *
 * @param signature - Candidate signature string.
 * @returns True when the string is non-empty, a multiple of 4 in length, and valid base64.
 */
export function isValidGoogleThoughtSignature(signature: string): boolean {
  if (signature.length === 0 || signature.length % 4 !== 0) return false
  return BASE64_SIGNATURE_PATTERN.test(signature)
}

/**
 * Determine whether a signature is valid base64 or the official Google bypass sentinel.
 *
 * @param signature - Candidate signature string.
 * @returns True if the signature can be sent to Google APIs.
 */
export function isUsableGoogleThoughtSignature(signature: string): boolean {
  return signature === SKIP_THOUGHT_SIGNATURE_VALIDATOR || isValidGoogleThoughtSignature(signature)
}

/**
 * Minimal structural typing for Google Gemini request payload function call part.
 */
interface GeminiPart {
  functionCall?: {
    name?: string | undefined
    args?: Record<string, unknown> | undefined
    id?: string | undefined
  } | undefined
  thoughtSignature?: string | undefined
  thought_signature?: string | undefined
}

/**
 * Minimal structural typing for Google Gemini request payload content.
 */
interface GeminiContent {
  role?: string | undefined
  parts?: GeminiPart[] | undefined
}

/**
 * Minimal structural typing for Google Gemini generateContent payload.
 */
interface GeminiPayload {
  contents?: GeminiContent[] | undefined
}

/**
 * Inspect a provider payload and ensure all historical function calls contain
 * a valid `thoughtSignature` when calling a Google Generative AI or Vertex endpoint.
 *
 * @param payload - The provider request payload built by pi-ai.
 * @param model - The resolved target model descriptor.
 * @param context - The pi-ai context containing original message history.
 * @returns The payload with restored or defaulted thought signatures.
 */
export function repairGoogleThoughtSignatures(
  payload: unknown,
  model: Model<Api>,
  context: PiContext,
): unknown {
  if (model.api !== 'google-generative-ai' && model.api !== 'google-vertex') {
    return payload
  }
  if (typeof payload !== 'object' || payload === null) {
    return payload
  }
  const genPayload = payload as GeminiPayload
  if (!Array.isArray(genPayload.contents)) {
    return payload
  }

  const signaturesById = new Map<string, string>()
  const sequentialSignatures: string[] = []

  for (const msg of context.messages) {
    if (msg.role === 'assistant') {
      for (const block of msg.content) {
        if (block.type === 'toolCall') {
          const sig = typeof block.thoughtSignature === 'string' && isUsableGoogleThoughtSignature(block.thoughtSignature)
            ? block.thoughtSignature
            : undefined
          if (sig !== undefined) {
            signaturesById.set(block.id, sig)
            sequentialSignatures.push(sig)
          } else {
            sequentialSignatures.push('')
          }
        }
      }
    }
  }

  let functionCallIndex = 0
  for (const content of genPayload.contents) {
    if (content.role === 'model' && Array.isArray(content.parts)) {
      for (const part of content.parts) {
        if (part.functionCall !== undefined) {
          const currentIndex = functionCallIndex++
          const existingSig = part.thoughtSignature ?? part.thought_signature
          if (typeof existingSig === 'string' && existingSig.length > 0) {
            continue
          }
          const callId = part.functionCall.id
          const candidateSig = (callId !== undefined ? signaturesById.get(callId) : undefined)
            ?? (sequentialSignatures[currentIndex] || undefined)
          part.thoughtSignature = candidateSig ?? SKIP_THOUGHT_SIGNATURE_VALIDATOR
        }
      }
    }
  }

  return payload
}
