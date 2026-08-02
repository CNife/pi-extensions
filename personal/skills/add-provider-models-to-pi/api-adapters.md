# api-adapters -- 按 api 类型适配参考

配置 `models.json` 时，按目标 provider 的 `api` 字段查对应节。每节给出 pi 如何把 `thinkingLevelMap` / `compat` 翻译成实际请求参数--这是「思考三层合成」Layer 1（Provider 机制）的事实依据。

源码行号随 pi 版本变，按函数名定位。源码根：`~/github/pi`（dev repo，已 link 到运行路径）或安装包 `@earendil-works/ai/dist/api/`。

> **何时查本节**：步骤 3（适配）与步骤 4（思考三层合成 Layer1）必查本文件对应 `api` 节。
> **完成检查**：写 `models.json` 前确认已--按 `api` 类型定位对应节；读其 compat 字段集 / 思考参数机制 / off 语义 / maxTokens 字段名 / 缓存 / tool 格式；据此定 `thinkingLevelMap` 各档位映射与 `compat` 显式覆盖（若有）。

---

## pi 共享机制：thinkingLevelMap 的 clamp

所有 api 类型共用同一套 level 处理，发生在按 api 发参数**之前**：pi 先把用户选的 level clamp 到该模型支持的档位，再查 `thinkingLevelMap[clampedLevel]` 取端点值。源码在 `models.js`（不在各 `api/*.ts`）。

### getSupportedThinkingLevels

返回该模型可选的档位列表（pi 据此决定展示哪些档）：

- `thinkingLevelMap[level] === null` -> **不支持**，过滤掉（不展示）。
- `level` 是 `xhigh` / `max` -> 必须 `thinkingLevelMap[level] !== undefined`（显式定义）才算支持。
- 其余档位（off/minimal/low/medium）-> `!== null` 即支持。

### clampThinkingLevel

把用户选的 level 映射到支持的档位：level 本身支持则原样返回；否则**先向上**找最近支持档（顺序 `off < minimal < low < medium < high < xhigh < max`），找不到再向下。

例：模型只配了 `low`/`high`/`max`（off/minimal/medium/xhigh 为 `null`），用户选 `medium` -> clamp 到 `high`；选 `off` -> clamp 到 `low`。

### 后果

各 api 节的 `effort = thinkingLevelMap[level] ?? level` 描述的是 clamp **之后**的取值。clamp 已保证 level 是支持档（`thinkingLevelMap[level]` 非 `null`），故 `??` 取到的是你填的端点值，**不会透传原始 level 字符串**。`null` 档位只会被 clamp 走，不会发到端点。

---

## openai-completions

Chat Completions 兼容端点（`/v1/chat/completions`）。pi 最通用的 api。

### compat 字段（精选，配置时常用）

完整定义见 `types.ts` 的 `OpenAICompletionsCompat`（~20 字段）。

- `thinkingFormat`：思考参数格式，10 种，`detectCompat` 按 provider/baseUrl 自动推断（见下表）。手动覆盖用 `model.compat.thinkingFormat`。
- `supportsReasoningEffort`：是否发 `reasoning_effort`（部分 format 配合用）。
- `supportsDeveloperRole`：`developer` vs `system` role。
- `maxTokensField`：`max_tokens` | `max_completion_tokens`。
- `supportsUsageInStreaming`：流式返回 usage。
- `supportsLongCacheRetention`：`prompt_cache_retention:"24h"`。
- `cacheControlFormat:"anthropic"`：openrouter 上的 anthropic 模型用 cache_control。
- `supportsStore` / `supportsStrictMode`（tool `strict` 字段）。

### pi 源码指针

`openai-completions.ts`：`detectCompat`（自动推断）、`getCompat`（合并 detect + model.compat）、`buildParams` 的 thinkingFormat 分支（思考参数生成）。

### 思考参数机制（按 `thinkingFormat`）

| thinkingFormat | 思考参数 | detectCompat 命中条件 |
|---|---|---|
| `openai`（默认） | `reasoning_effort` | 多数 provider |
| `openrouter` | `reasoning:{effort}` | openrouter.ai |
| `deepseek` | `thinking:{type}` + `reasoning_effort` | deepseek.com |
| `together` | `reasoning:{enabled}` + `reasoning_effort` | together.ai |
| `zai` | `thinking:{type}` + `reasoning_effort` | z.ai / bigmodel.cn |
| `qwen` | `enable_thinking` | - |
| `qwen-chat-template` | `chat_template_kwargs.enable_thinking` | - |
| `chat-template` | `chat_template_kwargs`（配置化） | - |
| `string-thinking` | `thinking`（字符串） | - |
| `ant-ling` | `reasoning:{effort}`（仅非 off） | ant-ling.com |

`effort` 取值 = `thinkingLevelMap[level] ?? level`。

### off 语义

⚠️ 纠正「off 时不发思考参数」--对 completions 多数 format 不成立：

- `thinkingLevelMap.off === null`：该档位不可选（pi 不展示），不会走到 off。
- `thinkingLevelMap.off` 非 null string：pi 按 format 发关闭信号--
  - `zai` / `deepseek`：`thinking:{type:"disabled"}`
  - `qwen` / `qwen-chat-template` / `together`：禁用标志（`enable_thinking:false` / `reasoning:{enabled:false}`）
  - `openrouter` / `string-thinking` / `openai`：explicit off 值（`reasoning:{effort:off}` / `thinking:off` / `reasoning_effort:off`；`openai` 需 `supportsReasoningEffort`，否则 off 不发）
  - `ant-ling` **例外**：off 时即便 off 非 null 也不发，落 provider 默认。

故 off 映射填非 null（如 `"none"`）= pi 发关闭信号；填 `null` = 不可选。

### maxTokens 字段

`maxTokensField`：`detectCompat` 中 moonshot / together / nvidia / ant-ling / cloudflare-gateway / chutes 用 `max_tokens`，其余 `max_completion_tokens`。

### 缓存机制

`prompt_cache_key`（sessionId）+ `prompt_cache_retention`（`supportsLongCacheRetention`）。openrouter 的 anthropic 模型走 `cache_control`（`cacheControlFormat:"anthropic"`，打在 system / tools / messages）。

### tool 格式

标准 openai `tools[]`，`supportsStrictMode` 控制 `strict` 字段。

---

## openai-responses

Responses API 端点（`/v1/responses`，或套餐端点如方舟 `/api/plan/v3/responses`）。

### compat 字段（仅 4 个）

完整定义见 `types.ts` 的 `OpenAIResponsesCompat`。

- `supportsDeveloperRole`：`developer` vs `system`（默认 true）。
- `sendSessionIdHeader`：发 `session_id` cache-affinity 头（默认 true）。
- `supportsLongCacheRetention`：`prompt_cache_retention:"24h"`（默认 true）。
- `supportsToolSearch`：client-executed tool search（默认 false）。
- **无** `thinkingFormat` / `supportsReasoningEffort` / `maxTokensField`--reasoning 格式固定。

### pi 源码指针

`openai-responses.ts`：`getCompat`、`buildParams`（reasoning 段）、`streamSimple`（off -> undefined）。

### 思考参数机制

固定 `reasoning:{effort, summary:"auto"}` + `include:["reasoning.encrypted_content"]`。`effort = thinkingLevelMap[level] ?? level`。无 format 切换。

### off 语义

⚠️ 与 completions 不同：

- `streamSimple` 把 off -> `reasoningEffort = undefined`。
- `buildParams`：`reasoningEffort` 为空时，若 `thinkingLevelMap.off !== null`，发 `reasoning:{effort: thinkingLevelMap.off ?? "none"}`（**显式关闭**）；若 `off === null`，不发 reasoning（落 provider 默认）。

故 off 映射填非 null（如 `"none"`）= pi 发 explicit effort 关闭；填 `null` = 不发、落默认。

### maxTokens 字段

固定 `max_output_tokens`（无 `maxTokensField` 选项）。

### 缓存机制

`prompt_cache_key`（sessionId）+ `prompt_cache_retention`（`supportsLongCacheRetention`）；`store:false` 固定。

### tool 格式

responses API `tools`（`convertResponsesTools`）；`supportsToolSearch` 支持 deferred tool search。

---

## anthropic-messages

Anthropic Messages 兼容端点（`/v1/messages`）。

### compat 字段（精选）

完整定义见 `types.ts` 的 `AnthropicMessagesCompat`。

- `forceAdaptiveThinking`：true = adaptive 模型（effort），false/缺省 = 老模型（budget）。
- `supportsEagerToolInputStreaming`：tool 流式 `eager_input_streaming`。
- `supportsLongCacheRetention`：`cache_control.ttl:"1h"`。
- `sendSessionAffinityHeaders`：`x-session-affinity` 头（Fireworks 等）。
- `supportsCacheControlOnTools`：tool 定义上的 `cache_control`。
- `supportsTemperature` / `supportsToolReferences` / `allowEmptySignature`。

### pi 源码指针

`anthropic-messages.ts`：`streamSimple`、`mapThinkingLevelToEffort`、`buildParams`（thinking 段）。

### 思考参数机制（两套，由 `forceAdaptiveThinking` 决定）

- **adaptive**（`forceAdaptiveThinking:true`）：发 `thinking:{type:"adaptive", display:"summarized"}` + `effort`（low / medium / high；`max` 全模型可用，`xhigh` 仅 Opus 4.7+ / Sonnet 5 / Fable 5）。
- **budget**（老模型）：发 `thinkingEnabled:true` + `thinkingBudgetTokens`（默认 1024，受 maxTokens 约束）。无 effort。
- `effort` 映射：`mapThinkingLevelToEffort` 优先 `thinkingLevelMap[level]`，否则 minimal/low -> low、medium -> medium、high -> high、default -> high。`xhigh`/`max` 不在默认 switch，仅当 `thinkingLevelMap` 显式配置时透传，否则落 default -> high。

### off 语义

`streamSimple` 在 `!reasoning` 时 `thinkingEnabled:false`，`buildParams` 不发 thinking 参数 -> 模型默认不思考。**off = 不发 thinking**（与 responses 的 explicit-effort 不同）。off 映射填非 null 仅标记「支持关闭」（pi 可选 off 档），实际不发参数。

### maxTokens 字段

固定 `max_tokens`。

### 缓存机制

`cache_control` 标记（打在 system prompt / tools / messages），`supportsLongCacheRetention` 控制 `ttl:"1h"`；`sendSessionAffinityHeaders` 控制 `x-session-affinity` 头。

### tool 格式

anthropic `tools`（`convertTools`）；`supportsToolReferences` 支持 deferred tools；`supportsEagerToolInputStreaming` 控制流式。
