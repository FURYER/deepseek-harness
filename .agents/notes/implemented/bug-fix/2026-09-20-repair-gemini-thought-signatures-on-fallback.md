# Agent Note: Repair Gemini Thought Signatures on Historical Function Calls

Status: implemented

English | [中文](2026-09-20-repair-gemini-thought-signatures-on-fallback.zh.md)

## Problem

Google Gemini 2.5 and 3.x require any historical `functionCall` part in a `model` turn to include a valid `thought_signature`. If a request omits `thought_signature` or sends an empty signature, Google Generative AI and Vertex endpoints reject the request with HTTP 400 `INVALID_ARGUMENT: Function call is missing a thought_signature in functionCall parts`. When the harness degrades or converts message history across models or providers (such as when fallback switches from Gemini 3.5 to Gemini 3.1, or between Google models), `@earendil-works/pi-ai` deletes `thoughtSignature` on `toolCall` blocks during `transformMessages` because `assistantMsg.model !== model.id`. Additionally, tool calls originating from non-Google models or sessions without captured signatures have no Google thought signature. Consequently, any subsequent call to a Gemini model in a session that contains prior tool calls fails immediately with HTTP 400.

## Decision

In `packages/llm/llm-pi-ai`, historical Google thought signatures are preserved and repaired before payloads reach Google APIs:
1. `foreignAssistant` in `packages/llm/llm-pi-ai/src/replay.ts` extracts `thoughtSignature` from `replayState.blocks` for `tool-call` blocks when degrading foreign model turns, preserving them in `AssistantMessage.content`.
2. `repairGoogleThoughtSignatures` in `packages/llm/llm-pi-ai/src/google-thought-signature.ts` hooks into pi-ai's `onPayload` callback in `PiAiAdapter.call()` (`packages/llm/llm-pi-ai/src/adapter.ts`). When targeting Google Generative AI or Vertex endpoints, it scans the built request payload for `model` content parts containing `functionCall`.
3. If a `functionCall` part lacks a valid `thoughtSignature`, it attempts to restore the original signature from `context.messages` matching by tool call ID (or sequential index). If no original signature exists (such as for cross-provider calls from Claude or DeepSeek, or tool calls without signatures), it supplies Google's documented validation bypass sentinel: `skip_thought_signature_validator`.

## Alternatives considered

- **Fork or monkey-patch `@earendil-works/pi-ai`**: Patch `pi-ai`'s `transformMessages` and `resolveThoughtSignature` to keep signatures across Gemini model versions. Rejected because upstream owns `pi-ai`, and `onPayload` already exists as an official extension seam designed for request payload mutation before provider dispatch.
- **Synthesize dummy base64 signatures for foreign tool calls**: Generate arbitrary base64 strings when a signature is missing. Rejected because Google APIs validate cryptographic signature authenticity on base64 strings and reject arbitrary fake signatures. Google explicitly supports `skip_thought_signature_validator` as the official sentinel for historical or externally generated tool calls.
- **Filter out historical tool calls on cross-model fallback**: Strip tool calls and results or collapse them into plain user/assistant text blocks. Rejected because downstream tools and session replay rely on structured tool calls and tool responses, and omitting them degrades model reasoning and tool state consistency.

## Consequences

- Multi-turn sessions with tool calls can switch or fallback to Google Gemini models (e.g. Gemini 3.5 to Gemini 3.1 fallback) without HTTP 400 rejection.
- Existing valid thought signatures from Gemini turns are preserved and replayed intact.
- Tool calls originating from other providers or turns without signatures bypass Google's thought signature validator via `skip_thought_signature_validator`.
- Payload mutation is isolated to Google endpoints (`google-generative-ai` and `google-vertex`) and does not affect OpenAI, Anthropic, or DeepSeek payloads.
