# @deepseek-ai/dsh-llm-fallback

Global LLM fallback service and waterfall interceptor for the DeepSeek Harness.
Intercepts rate limit (429, RPM/TPM exhaustion, Quota Exceeded) errors
and seamlessly switches to configured fallback models across all sessions.

## Features
- Global `llm/stream` waterfall interceptor.
- Automatic provider retry-delay detection from headers/messages or default cooldown.
- Tracks and skips cooled-down models on subsequent requests.
- Integrated with user settings (`llm-fallback` section in `settings.yaml`).
