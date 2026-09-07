# Agent Note: Persist Learned Token Limits in llm-pi-ai

Status: implemented

English | [中文](2026-09-08-pi-ai-persist-token-limits.zh.md)

## Problem

Google's Gemini free tier enforces a 250,000 input-token-per-minute quota that is not advertised in any pre-request metadata. The harness discovers the limit only after the first request triggers a 429 with the message `Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 250000`. Until that error arrives, `PiAiAdapter.modelInfo()` returns the catalog value (1,048,576 for Gemini models), so the context meter opens at 1M and drops to 250K on the first live request. On every backend restart the cycle repeats, because `dynamicLimits` was an in-memory `Map` discarded on exit.

## Decision

`TokenLimitStore` (`packages/llm/llm-pi-ai/src/token-limit-store.ts`) persists the discovered limits to `~/.dsh/llm-pi-ai/token-limits.json` (overridable via `DSH_HOME`). The file format is `{ "formatVersion": 1, "limits": { "provider/model": N } }`. On startup `PiAiAdapter` calls `TokenLimitStore.load()` synchronously — the only sync I/O in the path — so `modelInfo()` already returns the persisted limit before the first request and the context meter opens at the correct value from session start.

Writes are atomic via `writeFileAtomic` from `@deepseek-ai/dsh-atomic-write` (mode `0o600`, dirMode `0o700`). Concurrent saves chain through `pendingWrite` to avoid interleaved writes; an error in one write does not block subsequent saves. Setting `tokenLimitsPath: false` disables disk I/O for tests and embedded deployments. An `onTokenLimitError` callback routes write failures to the application logger without propagating them to callers.

`recordDynamicLimit` deduplicates by value before calling `save`, so a repeated 429 with the same limit does not trigger redundant writes.

## Alternatives considered

- **Static config override**: Let operators hard-code the limit in `cordis.yml`. Rejected because the value varies by account tier and is invisible without actually hitting the quota; a persisted discovery requires no operator action.
- **Re-discover on every restart**: The pre-existing behavior. Rejected because it forces at least one failed request on every cold start, shows an incorrect context window in the UI from open to first request, and repeats indefinitely.
- **Async load at adapter start**: Deferred the constructor-time sync load to a Promise resolved before the first request. Rejected because the first call to `modelInfo()` happens synchronously during plugin boot, before any async barrier could be awaited.

## Consequences

- The context meter opens at the persisted quota limit immediately on session start rather than at the catalog ceiling.
- Every adapter test that asserts the initial context window against the catalog value must be isolated from the real `~/.dsh/llm-pi-ai/token-limits.json`. The fix is `vi.stubEnv('DSH_HOME', '/nonexistent-test-dsh-home')` in `beforeEach`, ensuring `loadTokenLimitsSync` returns an empty map for every test.
- `defaultTokenLimitsPath` uses `resolveDshHome()` with no arguments, so `$DSH_HOME` controls the path at test time without changing the production code path.
- New runtime dependencies: `@deepseek-ai/dsh-atomic-write` and `@deepseek-ai/dsh-home-paths`.
