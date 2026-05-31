# 变更方案

## 目标

新建 `@cnife/pi-auto-naming-session` 扩展，在会话 turn 结束时自动生成并刷新纯描述性会话标题。

## 背景

现有 `@furbyhaxx/pi-session-naming` 功能臃肿（标签系统、`/sessions` 浏览、项目元数据、`/rename` 命令等），且有 bug。需要一个功能精简、职责单一的替代品——只做标题自动生成和按间隔刷新，不带任何交互式命令。

## 最终方案

### 包结构

```text
packages/auto-naming-session/
├── package.json            # @cnife/pi-auto-naming-session
└── extensions/
    └── index.ts            # 单一入口，事件注册 + 标题生成
```

### 配置

配置文件 `$PI_CODING_AGENT_DIR/cnife-pi-auto-naming-session.json`：

```json
{
  "auto_refresh_turns": 10,
  "model": null,
  "language": "english"
}
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `auto_refresh_turns` | `int \| null` | 10 | 每 N 个 turn 自动刷新标题。`null` 禁用自动刷新 |
| `model` | `str \| null` | `null` | 指定模型 `<provider>/<model>[:thinking_level]`，`null` 用当前主会话模型 |
| `language` | `str` | `"english"` | 标题语言 |

无 `enabled` 开关，删除文件/卸载扩展即禁用。

配置文件不存在时，`session_start` 时自动创建带有默认值的配置文件。解析失败（JSON 非法）时用代码内默认值继续，不阻塞功能，通过 `console.warn` 输出错误。

```typescript
const DEFAULT_CONFIG = {
  auto_refresh_turns: 10,
  model: null,
  language: "english",
};
```

### 架构流程

```text
turn_end 事件
    │
    ├── 是首个 turn → 生成标题
    │
    └── auto_refresh_turns ≠ null
            └── 当前总 turn 数 >= auto_refresh_turns + 1（跳过头 1 turn）
                    └── 且 (总 turn 数 - 1) % auto_refresh_turns === 0
                            → 生成标题

生成标题流程（全程 try/catch 包裹，异常时 ctx.ui.notify 后跳过）：
    1. 检查 ctx.model 是否可用 → 不可用则跳过
    2. 检查手动标题保护 → 当前 session name 与最后一条 appendEntry 的 title 不一致？→ 跳过（注意 getSessionName() 为 undefined 时视为无标题，不跳过）
    3. 读取/初始化配置文件（不存在时创建默认配置）
    4. 收集上下文（lastEntryId 之后的消息，仅 user + assistant）
    5. 解析 model 配置 → ctx.modelRegistry.find()（model 必须带 provider 前缀，否则跳过）
    6. 获取 auth → ctx.modelRegistry.getApiKeyAndHeaders()（检查 auth.ok，失败则跳过）
    7. 调用 completeSimple() 生成标题
    8. pi.setSessionName(result)
    9. pi.appendEntry("auto-naming-title", { title, lastEntryId, timestamp })
```

### 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 纯描述标题，无标签 | 去掉 Conventional Commit 格式的复杂度，沿用用户自然语言 |
| 2 | lastEntryId 追踪消息范围 | 每次只传新消息，避免重复消耗 token |
| 3 | 独立 JSON 配置文件 | 不侵入 pi 的 settings.json 体系，配置即文件存在 |
| 4 | 无 `/rename` 等命令 | 职责单一——只做自动生成，交互式编辑不在范围内 |
| 5 | appendEntry 做手动标题保护 | pi 无原生 API 区分，自定义 entry 比对即可 |
| 6 | 无重试/回退机制 | 简化版不处理模型调用失败，第一次失败即跳过，等待下次刷新 |
| 7 | 全程 try/catch 包裹 | 异常时通知用户然后跳过，不影响 pi 稳定性 |
| 8 | 消息上下文仅含 user + assistant | tool 消息噪音多，对标题生成价值低 |
| 9 | model 配置必须带 provider 前缀 | 防止配置错误导致误用无关模型 |

### LLM 调用细节

```typescript
import { completeSimple } from "@earendil-works/pi-ai";

// 模型解析：model 配置必须带 provider 前缀，否则返回 undefined
function parseModelRef(ref: string): { provider: string; id: string; thinking?: ThinkingLevel } | undefined {
  // <provider>/<model>[:thinking_level]
  const trimmed = ref.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return undefined; // 必须带 provider 前缀
  const provider = trimmed.slice(0, slash);
  let id = trimmed.slice(slash + 1);
  if (!id) return undefined;
  let thinking: ThinkingLevel | undefined;
  const colon = id.lastIndexOf(":");
  if (colon > 0) {
    const suffix = id.slice(colon + 1);
    if (["minimal", "low", "medium", "high", "xhigh"].includes(suffix)) {
      thinking = suffix as ThinkingLevel;
      id = id.slice(0, colon);
    }
  }
  if (!id) return undefined;
  return { provider, id, thinking };
}

// 调用
const model = config.model
  ? ctx.modelRegistry.find(parsed.provider, parsed.id)
  : ctx.model;
if (!model) return;
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
if (!auth.ok) return;
const msg = await completeSimple(model, {
  systemPrompt: SYSTEM_PROMPT,
  messages: [{ role: "user", content: transcript, timestamp: Date.now() }],
}, {
  apiKey: auth.apiKey,
  headers: auth.headers,
  maxTokens: 80,
  temperature: 0.3,
});
```

### System Prompt

```text
You are a session title generator for a coding agent. Output ONLY a title — no preamble, quotes, markdown, commentary, or trailing punctuation.

Rules:
- One line only, no markdown, no quotes, no trailing period
- Maximum {{max_length}} characters
- Describe the main topic of the conversation concisely and specifically
- Use {{language}} language
- Capitalize first letter
- Never include tool names, session, or conversation meta-words

Examples:
- "Refactor authentication middleware"
- "Fix database connection timeout"
- "Design API schema for user profiles"
- "Debug webhook signature verification"
- "Upgrade dependency versions"
```

max_length 硬编码 60，不暴露为配置项。

### 消息上下文格式

每次生成只发 `lastEntryId` 之后的消息（首次或找不到 lastEntryId 时发全部），仅含 user + assistant：

```text
<session-transcript>
[user] fix the auth endpoint
[assistant] Let me look at the auth middleware...
</session-transcript>
```

不含 tool 消息（噪音多，对标题生成价值低）。

### 事件处理

| 事件 | 行为 |
|------|------|
| `turn_end` | 判断触发条件，符合则生成标题 |
| `session_start` | 重置 turn 计数器为 0，不清除已有 appendEntry（恢复旧会话后仍可做手动标题保护判断） |

### turn 计数实现

不依赖 `ctx.sessionManager` 的全量消息数（compact 会压缩）。用内存变量：

```typescript
let turnCount = 0;

pi.on("turn_end", async (_event, ctx) => {
  turnCount++;
  try {
    if (turnCount === 1) {
      await generateTitle(ctx);
    } else if (config.auto_refresh_turns !== null && turnCount >= config.auto_refresh_turns + 1) {
      if ((turnCount - 1) % config.auto_refresh_turns === 0) {
        await generateTitle(ctx);
      }
    }
  } catch (error) {
    if (ctx.hasUI)
      ctx.ui.notify(`Title generation failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
  }
});

pi.on("session_start", () => {
  turnCount = 0;
});
```

### 手动标题保护

```typescript
// 生成后记录（timestamp 始终包含）
pi.appendEntry("auto-naming-title", { title, lastEntryId, timestamp: Date.now() });

// 下次生成前检查：遍历 session entries 找最新的 auto-naming-title entry
const latest = findLatestAutoNamingEntry(ctx.sessionManager.getEntries());
const currentName = pi.getSessionName();
// currentName 为 undefined 时视为无标题，不视为手动修改
if (latest && currentName !== undefined && currentName !== latest.data.title) {
  // 用户手动改过标题 → 跳过
  return;
}
```

## 用语

见 `CONTEXT.md`。

## 假设

1. user + assistant 消息的 `firstTextContent` 提取后作为标题生成上下文足够。
2. `completeSimple` 调用失败时 catch 后通知用户再跳过。
3. 配置文件的 `language` 值作为自然语言名称直接填入 system prompt 模板。
4. 配置文件不存在时自动创建的默认值在后续使用中不会因写权限问题失败。
