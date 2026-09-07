# Agent Note：在 llm-pi-ai 中持久化已发现的令牌限制

Status: implemented

[English](2026-09-08-pi-ai-persist-token-limits.md) | 中文

## 问题

Google Gemini 免费层对每分钟输入令牌数设有 250,000 的配额，但该配额不出现在任何预请求元数据中。适配器只有在首次请求触发 429 错误（消息为 `Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 250000`）后才能得知限制值。在此之前，`PiAiAdapter.modelInfo()` 返回 catalog 值（Gemini 模型为 1,048,576），因此上下文计量器在会话开始时显示 1M，并在首次实际请求后骤降至 250K。由于 `dynamicLimits` 是进程内的 `Map`，在进程退出时会被丢弃，因此每次后端重启都会重复这一循环。

## 决策

`TokenLimitStore`（`packages/llm/llm-pi-ai/src/token-limit-store.ts`）将发现的限制持久化到 `~/.dsh/llm-pi-ai/token-limits.json`（可通过 `DSH_HOME` 覆盖）。文件格式为 `{ "formatVersion": 1, "limits": { "provider/model": N } }`。启动时 `PiAiAdapter` 同步调用 `TokenLimitStore.load()`——这是该路径中唯一的同步 I/O——使 `modelInfo()` 在首次请求前就能返回持久化的限制值，从而让上下文计量器从会话开始就显示正确数值。

写入通过 `@deepseek-ai/dsh-atomic-write` 的 `writeFileAtomic` 原子完成（mode `0o600`，dirMode `0o700`）。并发保存通过 `pendingWrite` 链式执行，避免交错写入；单次写入错误不阻塞后续保存。将 `tokenLimitsPath` 设为 `false` 可在测试和嵌入式部署中禁用磁盘 I/O。`onTokenLimitError` 回调将写入失败路由至应用日志，而不会将其传播给调用方。

`recordDynamicLimit` 在调用 `save` 前按值去重，因此针对同一限制的重复 429 不会触发冗余写入。

## 备选方案

- **静态配置覆盖**：允许运维人员在 `cordis.yml` 中硬编码限制值。已拒绝，因为该值因账号层级而异，且在实际触发配额前不可见；持久化的自动发现无需运维干预。
- **每次重启重新发现**：保持原有行为。已拒绝，因为它强制在每次冷启动时至少发出一次失败请求，并在 UI 中从打开到首次请求期间显示错误的上下文窗口，且会无限重复。
- **启动时异步加载**：将构造时同步加载改为 Promise，在首次请求前等待解析。已拒绝，因为 `modelInfo()` 的首次调用发生在插件启动期间的同步路径中，无法在任何异步屏障之后等待。

## 影响

- 上下文计量器在会话开始时立即以持久化的配额限制值打开，而不再是 catalog 上限值。
- 所有针对初始上下文窗口的适配器测试都必须与真实的 `~/.dsh/llm-pi-ai/token-limits.json` 隔离。修复方式是在 `beforeEach` 中调用 `vi.stubEnv('DSH_HOME', '/nonexistent-test-dsh-home')`，确保 `loadTokenLimitsSync` 在每个测试中返回空 map。
- `defaultTokenLimitsPath` 不带参数调用 `resolveDshHome()`，因此 `$DSH_HOME` 可在测试时控制路径，无需修改生产代码路径。
- 新增运行时依赖：`@deepseek-ai/dsh-atomic-write` 和 `@deepseek-ai/dsh-home-paths`。
