# Agent Note: 历史函数调用中修复 Gemini 思考签名

Status: implemented

[English](2026-09-20-repair-gemini-thought-signatures-on-fallback.md) | 中文

## Problem

Google Gemini 2.5 和 3.x 要求 `model` 轮次中的任何历史 `functionCall` 部分都必须包含有效的 `thought_signature`。如果请求省略了 `thought_signature` 或发送了空签名，Google Generative AI 和 Vertex 端点将以 HTTP 400 `INVALID_ARGUMENT: Function call is missing a thought_signature in functionCall parts` 拒绝该请求。当框架跨模型或提供商降级或转换消息历史时（例如在 Gemini 3.5 回退到 Gemini 3.1 时，或在不同的 Google 模型之间切换时），`@earendil-works/pi-ai` 会在 `transformMessages` 期间删除 `toolCall` 块上的 `thoughtSignature`，因为 `assistantMsg.model !== model.id`。此外，来自非 Google 模型或没有捕获签名的会话中的工具调用完全没有 Google 思考签名。因此，在包含既往工具调用的会话中，后续任何对 Gemini 模型的调用都会立即以 HTTP 400 失败。

## Decision

在 `packages/llm/llm-pi-ai` 中，历史 Google 思考签名会在载荷到达 Google API 之前得到保留和修复：
1. `packages/llm/llm-pi-ai/src/replay.ts` 中的 `foreignAssistant` 在降级外部模型轮次时，从 `replayState.blocks` 中为 `tool-call` 块提取 `thoughtSignature`，并将其保存在 `AssistantMessage.content` 中。
2. `packages/llm/llm-pi-ai/src/google-thought-signature.ts` 中的 `repairGoogleThoughtSignatures` 接入 `PiAiAdapter.call()`（`packages/llm/llm-pi-ai/src/adapter.ts`）中 pi-ai 的 `onPayload` 回调。当目标为 Google Generative AI 或 Vertex 端点时，它会扫描构建出的请求载荷中包含 `functionCall` 的 `model` 内容部分。
3. 如果 `functionCall` 部分缺少有效的 `thoughtSignature`，它会尝试通过工具调用 ID（或顺序索引）匹配，从 `context.messages` 中恢复原始签名。如果不存在原始签名（例如来自 Claude 或 DeepSeek 的跨提供商调用，或没有签名的工具调用），它会提供 Google 文档中记载的验证绕过哨兵值：`skip_thought_signature_validator`。

## Alternatives considered

- **Fork 或猴子补丁（monkey-patch）`@earendil-works/pi-ai`**：修补 `pi-ai` 的 `transformMessages` 和 `resolveThoughtSignature` 以保留跨 Gemini 模型版本的签名。被否决，因为 upstream 拥有 `pi-ai`，且 `onPayload` 本身就是为请求载荷在派发至提供商前进行变更而设计的官方扩展切面。
- **为外部工具调用合成伪造的 base64 签名**：在缺少签名时生成任意 base64 字符串。被否决，因为 Google API 会对 base64 字符串验证加密签名的真实性并拒绝任意伪造的签名。Google 明确支持使用 `skip_thought_signature_validator` 作为历史或外部生成的工具调用的官方哨兵值。
- **在跨模型回退时过滤掉历史工具调用**：剥离工具调用及其结果，或将它们折叠为纯文本的 user/assistant 块。被否决，因为下游工具和会话回放依赖结构化的工具调用和工具响应，省略它们会降低模型推理能力并破坏工具状态的一致性。

## Consequences

- 包含工具调用的多轮会话可以平滑切换或回退到 Google Gemini 模型（例如从 Gemini 3.5 回退到 Gemini 3.1），而不会遭遇 HTTP 400 拒绝。
- 来自 Gemini 轮次的现有有效思考签名会被完整保留并原样重放。
- 源自其他提供商或缺少签名的轮次的工具调用将通过 `skip_thought_signature_validator` 绕过 Google 的思考签名验证器。
- 载荷变更严格隔离在 Google 端点（`google-generative-ai` 和 `google-vertex`）中，不会影响 OpenAI、Anthropic 或 DeepSeek 的载荷。
