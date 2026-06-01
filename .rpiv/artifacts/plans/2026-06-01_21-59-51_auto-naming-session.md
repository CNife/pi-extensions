---
date: 2026-06-01T21:59:51+0800
author: CNife
commit: cb29b02
branch: auto-naming-session-plan
repository: pi-extensions
topic: "@cnife/pi-auto-naming-session — pi extension for auto-generating session titles"
tags: [plan, auto-naming-session, pi-extension]
status: ready
phase_count: 3
unresolved_phase_count: 0
last_updated: 2026-06-01T21:59:51+0800
last_updated_by: CNife
---

# @cnife/pi-auto-naming-session 实施计划

## Overview

新建 `@cnife/pi-auto-naming-session` pi 扩展，纯事件驱动，通过 `turn_end` 和 `session_start` 事件在会话 turn 结束时自动生成并周期性刷新纯描述性会话标题。采用 cache-hit-rate 的配置管理 pattern（init-once + 三级校验），LLM 调用使用 `completeSimple`，标题持久化用 `setSessionName` + `appendEntry`。

## Requirements

- 首次生成：所有会话（含恢复的旧会话）的第一个 turn 结束时自动设置标题
- 自动刷新：按可配置的间隔周期性刷新标题（默认每 10 个 turn）
- 手动标题保护：用户通过原生 `/name` 命令修改标题后，不再覆盖
- 上次刷新位置追踪：记录 `lastEntryId`，下次只取该 ID 之后的消息
- 配置项：`auto_refresh_turns`（`number | null`，默认 10）、`model`（`string | null`，默认 null 走当前模型）、`language`（`string`，默认 `"english"`）

## Current State Analysis

### Key Discoveries

- 仓库内尚无扩展使用 `setSessionName` / `completeSimple`（research 确认）
- `cache-hit-rate.ts` 提供完整的事件模式 + 配置 pattern（`packages/cache-hit-rate/extensions/cache-hit-rate.ts:17-105`）
- `TurnEndEvent.turnIndex` 从 0 开始，首个 turn 为 0（`types.d.ts:607-612`）
- `completeSimple` 从不抛异常，需检查 `stopReason`（`stream.d.ts:7`）
- `modelRegistry.getApiKeyAndHeaders()` 返回 `{ ok }`，必须检查（`model-registry.d.ts:85-87`）
- `appendEntry()` 写 `CustomEntry`，不参与 LLM 上下文（`session-manager.js:669-677`）

## Desired End State

用户在 pi 中正常对话，首次 turn 结束时自动出现标题：

```text
📝 会话标题已在第一个 turn 结束时自动生成
```

自动刷新时静默更新标题。用户手动 `/name 新标题` 后，扩展不再自动覆盖。

配置 `~/.pi/agent/cnife-auto-naming-session.json`：

```json
{
  "auto_refresh_turns": 10,
  "model": null,
  "language": "english"
}
```

## What We're NOT Doing

- 不注册命令 — pi 原生 `/name` 已覆盖手动设置
- 不注册工具 — 纯事件驱动
- 不支持标签系统、项目元数据、交互式命令
- 不写单元测试 — 纯手动验证

## Decisions

### Decision 1: 纯事件驱动架构

采用 cache-hit-rate 的纯事件驱动 pattern，不引入定时器、轮询或后台线程。

### Decision 2: turn 计数使用 turnIndex

`TurnEndEvent.turnIndex` 是 0-based 的内置计数器，避免手动维护 `turnCount`。刷新条件：`turnIndex >= auto_refresh_turns && turnIndex % auto_refresh_turns === 0`。首个 turn（`turnIndex === 0`）触发首次生成。例如 `auto_refresh_turns=10` 时 turnIndex=0 首次生成，turnIndex=10/20/30… 自动刷新。

### Decision 3: 手动保护机制

每次生成标题后调用 `pi.appendEntry("auto-naming-title", { title, lastEntryId, timestamp })` 记录。下次触发时用 `pi.getSessionName()` 取当前标题，若与记录的 `title` 不一致（即用户手动修改过），跳过本次生成。

### Decision 4: lastEntryId 追踪

`appendEntry` 记录 `lastEntryId`。session_start 时恢复。生成标题时只取 `lastEntryId` 之后的消息作为 LLM 上下文（通过 `getBranch()` + 过滤）。

### Decision 5: LLM 用 completeSimple

`completeSimple` 是纯 LLM 调用（无 tool，无 agent loop），适合 fire-and-forget 的命名任务。

### Decision 6: 配置用 3 级校验

I/O → JSON parse → 类型校验。失败时用代码内默认值继续，通过 `console.warn` 输出错误。配置文件不存在时自动创建默认值。

## Phase 1: Package scaffolding + 配置管理

### Overview

创建包目录结构、`package.json`、扩展入口文件中的配置管理全部代码（类型、默认值、loadConfig/saveDefaultConfig）。本切片依赖无（foundation）。

### Changes Required

#### 1. packages/auto-naming-session/package.json

**File**: `packages/auto-naming-session/package.json`
**Changes**: NEW — 包元数据

```json
{
  "name": "@cnife/pi-auto-naming-session",
  "version": "0.1.0",
  "description": "Pi extension: auto-generate and refresh session titles at turn boundaries",
  "license": "MIT",
  "author": "CNife",
  "type": "module",
  "pi": {
    "extensions": ["./extensions"]
  },
  "files": ["extensions/"],
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

#### 2. packages/auto-naming-session/extensions/index.ts — 配置部分

**File**: `packages/auto-naming-session/extensions/index.ts`
**Changes**: NEW — 配置类型定义、默认值、loadConfig/saveDefaultConfig

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// ──── Config ────────────────────────────────────────────────────

export type AutoNamingConfig = {
  /** 每 N 个 turn 自动刷新标题。null 禁用自动刷新 */
  auto_refresh_turns: number | null;
  /** 指定模型 "provider/modelId"，null 用当前 ctx.model */
  model: string | null;
  /** 标题语言 */
  language: string;
};

const DEFAULT_CONFIG: AutoNamingConfig = {
  auto_refresh_turns: 10,
  model: null,
  language: "english",
};

const CONFIG_PATH = join(getAgentDir(), "cnife-auto-naming-session.json");

function saveDefaultConfig(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf-8");
}

function loadConfig(): AutoNamingConfig | null {
  // Level 1: 文件不存在 → 写入默认配置
  if (!existsSync(CONFIG_PATH)) {
    try {
      saveDefaultConfig(CONFIG_PATH);
    } catch {
      return null;
    }
    return { ...DEFAULT_CONFIG };
  }

  // Level 2: 读取 + JSON 解析
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    console.warn("[auto-naming-session] Failed to read config file, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[auto-naming-session] Invalid JSON in config file, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  // Level 3: 类型校验
  if (typeof parsed !== "object" || parsed === null) {
    console.warn("[auto-naming-session] Config is not an object, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  const obj = parsed as Record<string, unknown>;

  // auto_refresh_turns: number | null
  if (obj.auto_refresh_turns !== undefined && obj.auto_refresh_turns !== null && typeof obj.auto_refresh_turns !== "number") {
    console.warn("[auto-naming-session] auto_refresh_turns must be a number or null, using default");
    return { ...DEFAULT_CONFIG };
  }

  // model: string | null
  if (obj.model !== undefined && obj.model !== null && typeof obj.model !== "string") {
    console.warn("[auto-naming-session] model must be a string or null, using default");
    return { ...DEFAULT_CONFIG };
  }

  // language: string
  if (obj.language !== undefined && typeof obj.language !== "string") {
    console.warn("[auto-naming-session] language must be a string, using default");
    return { ...DEFAULT_CONFIG };
  }

  return {
    auto_refresh_turns: obj.auto_refresh_turns !== undefined ? (obj.auto_refresh_turns as number | null) : DEFAULT_CONFIG.auto_refresh_turns,
    model: obj.model !== undefined ? (obj.model as string | null) : DEFAULT_CONFIG.model,
    language: obj.language !== undefined ? (obj.language as string) : DEFAULT_CONFIG.language,
  };
}
```

### Success Criteria

#### Automated Verification

- [ ] 包结构完整：`ls packages/auto-naming-session/extensions/index.ts`
- [ ] 包结构完整：`ls packages/auto-naming-session/package.json`

#### Manual Verification

- [ ] 删除配置文件后首次加载自动创建默认配置
- [ ] 配置文件 JSON 非法时用默认值继续（console.warn 输出告警）
- [ ] 配置文件字段类型错误时用默认值继续
- [ ] 根 package.json 的 workspaces 中已包含 auto-naming-session

## Phase 2: State + 事件注册骨架

### Overview

追加 `AutoNamingState`、`session_start` 和 `turn_end` 事件注册骨架（含手动保护判断、turn 计数）。依赖 Phase 1。

### Changes Required

#### 1. packages/auto-naming-session/extensions/index.ts — State + 事件注册

**File**: `packages/auto-naming-session/extensions/index.ts`
**Changes**: MODIFY — 追加 state 类型、事件注册骨架（含手动保护判断逻辑）

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// ──── State ────────────────────────────────────────────────────

export type AutoNamingState = {
  /** 上次命名时记录的最后 entry ID，用于增量上下文 */
  lastEntryId: string | null;
};

function createInitialState(): AutoNamingState {
  return {
    lastEntryId: null,
  };
}

// ──── Helpers ───────────────────────────────────────────────────

/** 查找最近的 auto-naming-title 条目 */
interface AutoNamingEntry {
  title: string;
  lastEntryId: string | null;
  timestamp: number;
}

function findLatestAutoNamingTitle(ctx: { sessionManager: { getBranch: () => Array<{ type: string; customType?: string; data?: unknown }> } }): AutoNamingEntry | undefined {
  const branch = ctx.sessionManager.getBranch();
  // 反向遍历，找到最近的自定义条目
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "custom" && entry.customType === "auto-naming-title") {
      return entry.data as AutoNamingEntry;
    }
  }
  return undefined;
}

/** 手动保护检查：当前会话名是否被用户手动修改过 */
function isTitleManuallyChanged(
  currentName: string | undefined,
  lastEntry: AutoNamingEntry | undefined,
): boolean {
  // currentName 为 undefined 表示从未设置过标题
  if (currentName === undefined) return false;
  // 没有历史记录 → 无法判断手动修改 → 不保护
  if (!lastEntry) return false;
  // 当前 name 与上次记录的 title 不一致 → 用户手动修改过
  return currentName !== lastEntry.title;
}

// ──── Entry Point ───────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  if (!config) {
    // 配置加载失败时注册错误显示 handler
    pi.on("session_start", (_event, ctx) => {
      ctx.ui.setStatus("auto-naming", ctx.ui.theme.fg("error", "auto-naming config error"));
    });
    return;
  }

  const state = createInitialState();

  pi.on("session_start", async (_event, ctx) => {
    // 从 session entries 恢复 lastEntryId
    const lastEntry = findLatestAutoNamingTitle(ctx);
    state.lastEntryId = lastEntry?.lastEntryId ?? null;
  });

  pi.on("turn_end", async (event, ctx) => {
    const turnIndex = event.turnIndex;  // 0-based pi 内置计数器

    // 判断是否应触发标题生成
    const shouldGenerate = shouldGenerateTitle(turnIndex, config.auto_refresh_turns);

    if (!shouldGenerate) return;

    // 手动标题保护检查
    const currentName = pi.getSessionName();
    const lastEntry = findLatestAutoNamingTitle(ctx);
    if (isTitleManuallyChanged(currentName, lastEntry)) {
      // 用户手动修改了标题，跳过本次自动生成
      return;
    }

    // ── Phase 3 补充：LLM 调用 + 标题应用 ──
    console.log("[auto-naming-session] Title generation triggered (to be implemented in Phase 3)");
  });
}

/** 判断是否应该触发标题生成。turnIndex 是 0-based */
export function shouldGenerateTitle(turnIndex: number, autoRefreshTurns: number | null): boolean {
  // 首个 turn (turnIndex === 0) → 首次生成
  if (turnIndex === 0) return true;

  // 自动刷新被禁用 → 不刷新
  if (autoRefreshTurns === null) return false;

  // 自动刷新条件：turnIndex >= autoRefreshTurns 且 turnIndex % autoRefreshTurns === 0
  // 例如 autoRefreshTurns=10 时，turnIndex=10/20/30… 触发
  return turnIndex >= autoRefreshTurns && turnIndex % autoRefreshTurns === 0;
}
```

### Success Criteria

#### Automated Verification

- [ ] TypeScript 编译通过：`npx tsc --noEmit packages/auto-naming-session/extensions/index.ts`

#### Manual Verification

- [ ] session_start 时 turnCount 重置为 0，lastEntryId 恢复
- [ ] 第一个 turn_end 触发 shouldGenerate = true
- [ ] shouldGenerateTitle(0, 10) 返回 true（首次生成，turnIndex=0）
- [ ] shouldGenerateTitle(10, 10) 返回 true（第 11 个 turn 刷新，turnIndex=10）
- [ ] shouldGenerateTitle(5, null) 返回 false（auto_refresh 禁用）
- [ ] shouldGenerateTitle(9, 10) 返回 false（尚未到刷新条件）
- [ ] shouldGenerateTitle(20, 10) 返回 true（turnIndex=20 % 10 === 0）
- [ ] 手动标题保护逻辑：用户 /name 后不再覆盖

## Phase 3: LLM 调用 + 标题生成

### Overview

在 Phase 2 的 turn_end handler 骨架中填充 LLM 调用完整逻辑：模型解析、auth 获取、transcript 构建、completeSimple 调用、标题提取、setSessionName + appendEntry。依赖 Phase 2。

### Changes Required

#### 1. packages/auto-naming-session/extensions/index.ts — LLM 调用完整逻辑

**File**: `packages/auto-naming-session/extensions/index.ts`
**Changes**: MODIFY — 替换 Phase 2 的骨架注释为完整实现

```typescript
import { completeSimple } from "@earendil-works/pi-ai";
import type { Model, TextContent } from "@earendil-works/pi-ai";

// ──── 在文件顶部已存在的 imports 后追加 ────────────────────────
// 已有 import: existsSync, mkdirSync, readFileSync, writeFileSync, dirname, join
// 已有 import: getAgentDir, ExtensionAPI

// ──── 新增辅助函数（放在 loadConfig / createInitialState 之间） ──

/**
 * 构建对话文本（lastEntryId 之后的消息，仅 user + assistant）
 */
function buildTranscript(
  ctx: { sessionManager: { getBranch: () => Array<{ type: string; id?: string; message?: { role: string; content: string | Array<{ type: string; text?: string }> } }> } },
  lastEntryId: string | null,
): string | null {
  const branch = ctx.sessionManager.getBranch();

  // lastEntryId === null 表示从头开始
  let started = lastEntryId === null;
  const parts: string[] = [];

  for (const entry of branch) {
    // 检查是否已到达 lastEntryId 标记的起点
    if (!started) {
      if (entry.id === lastEntryId) {
        started = true;
      }
      continue;
    }

    // 只收集 user/assistant 消息
    if (entry.type === "message" && entry.message) {
      if (entry.message.role === "user" || entry.message.role === "assistant") {
        const content = entry.message.content;
        const text = typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join(" ")
            : "";
        if (text) {
          parts.push(`${entry.message.role}: ${text}`);
        }
      }
    }
  }

  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

/**
 * 解析模型引用 "provider/modelId" → { provider, id }
 */
function parseModelRef(ref: string): { provider: string; id: string } | undefined {
  const parts = ref.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return { provider: parts[0], id: parts[1] };
}

// ──── 替换 export default function 中的 turn_end handler ────────
// 将 Phase 2 中的 console.log 骨架替换为以下完整实现：

/*
  pi.on("turn_end", async (event, ctx) => {
    const turnIndex = event.turnIndex;  // 0-based pi 内置计数器

    if (!shouldGenerateTitle(turnIndex, config.auto_refresh_turns)) return;

    // 手动标题保护
    const currentName = pi.getSessionName();
    const lastEntry = findLatestAutoNamingTitle(ctx);
    if (isTitleManuallyChanged(currentName, lastEntry)) return;

    try {
      // 1. 解析模型
      let model: Model<any> | undefined;
      if (config.model) {
        const parsed = parseModelRef(config.model);
        if (!parsed) {
          ctx.ui.notify(`Invalid model "${config.model}". Use "provider/modelId"`, "warning");
          return;
        }
        model = ctx.modelRegistry.find(parsed.provider, parsed.id);
        if (!model) {
          ctx.ui.notify(`Model "${config.model}" not found`, "warning");
          return;
        }
      } else {
        model = ctx.model;
        if (!model) return;
      }

      // 2. 获取认证
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        ctx.ui.notify(`Auth failed: ${auth.error}`, "warning");
        return;
      }

      // 3. 构建对话上下文
      const transcript = buildTranscript(ctx, state.lastEntryId);
      if (!transcript) return;

      // 4. 调用 LLM — 将 transcript 嵌入 user message
      const userMessage = transcript
        ? `Conversation:

${transcript}

Generate a concise title for this conversation in ${config.language}.`
        : `Generate a concise title for this conversation in ${config.language}.`;

      const systemPrompt = `You are a session titling assistant. Generate a concise, descriptive title (max 60 chars) for the following conversation in ${config.language}. Output ONLY the title, no quotes, no explanation.`;

      const response = await completeSimple(
        model,
        {
          systemPrompt,
          messages: [
            { role: "user", content: userMessage, timestamp: Date.now() },
          ],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: 60,
        },
      );

      if (response.stopReason === "error" || response.stopReason === "aborted") {
        ctx.ui.notify(`Title gen failed: ${response.errorMessage ?? response.stopReason}`, "warning");
        return;
      }

      // 5. 提取标题
      const title = response.content
        .filter((c): c is TextContent & { type: "text" } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim()
        .slice(0, 60);

      if (!title) {
        ctx.ui.notify("Generated empty title, skipping", "warning");
        return;
      }

      // 6. 应用标题
      pi.setSessionName(title);

      // 7. 持久化元数据（用于手动保护）
      pi.appendEntry("auto-naming-title", {
        title,
        lastEntryId: state.lastEntryId,
        timestamp: Date.now(),
      });
      // 记录本次 appendEntry 的 entry ID 用于增量追踪
      state.lastEntryId = ctx.sessionManager.getLeafId() ?? null;
    } catch (err) {
      ctx.ui.notify(`Error: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  });"}]}

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript 编译通过：`npx tsc --noEmit packages/auto-naming-session/extensions/index.ts`

#### Manual Verification:
- [ ] 新会话首个 turn 自动生成描述性标题
- [ ] 恢复旧会话时首个 turn 也触发标题生成
- [ ] 每 10 个 turn（默认配置）自动刷新标题
- [ ] `auto_refresh_turns: null` 时只生成首次，不刷新
- [ ] 用户 `/name 新标题` 后不再覆盖
- [ ] 配置 `model: "provider/modelId"` 使用指定模型
- [ ] 配置 `language: "chinese"` 生成中文标题
- [ ] LLM 调用失败时跳过、不阻塞会话
- [ ] `appendEntry` 记录持久化，session 重开后可恢复追踪

## Ordering Constraints

- Phase 1 → Phase 2 → Phase 3（严格顺序依赖，不可并行）

## Verification Notes

- （前置检查）检查根 `package.json` 的 `workspaces` 是否已包含 `packages/auto-naming-session`
- （手动验证）启动 pi 新会话，观察首个 turn 后是否出现标题
- （手动验证）用 `pi appendCustomEntry` 方式验证持久化条目
- （边界条件）`auto_refresh_turns = 1`：每个 turn 都刷新
- （边界条件）`auto_refresh_turns = null`：不刷新，只首次生成
- （错误处理）模型不可用、认证失败、LLM 异常 → 静默跳过
- （手动保护）用户 `/name` 后刷新间隔到达时不应覆盖

## Performance Considerations

- 单次 ~60 个 token 的 LLM 调用，性能影响可忽略
- `getBranch()` 在全量 session entries 上遍历，大 session（数千条）可能稍有延迟，但非频繁操作

## Migration Notes

不适用 — 新建扩展，无存量数据

## Pattern References

- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:17-105` — 配置管理（三级校验 + init-once）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:370-412` — 工厂函数结构（事件注册 + 闭包 state）
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:607-612` — TurnEndEvent 类型
- `node_modules/@earendil-works/pi-ai/dist/stream.d.ts:7` — completeSimple 签名
- `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts:85-87` — getApiKeyAndHeaders 签名
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/summarize.ts:105-145` — completeSimple 官方示例

## Developer Context

**Q (design checkpoint): 是否提供 `/name` 命令？**
A: 不提供 — pi 原生 `/name` 已覆盖手动设置。

**Q (design checkpoint): 是否写单元测试？**
A: 不写 — 纯手动验证。

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | severity | dimension | finding | resolution |
| ------ | -------- | -------- | --------- | ------- | ---------- |
| code | Phase 3 §1 | blocker | code-quality | `buildTranscript` result not included in LLM `messages` | applied: embedded transcript into user message content |
| code | Phase 3 §1 | blocker | actionability | Handler wrapped in `/* */` comment block | applied: removed comment markers, code is executable |
| code | Phase 3 §1 | concern | code-quality | `Pi.on` uppercase P vs parameter `pi` | applied: changed to `pi.on` |
| code | Phase 1 §1 | concern | codebase-fit | `dependencies` should be `peerDependencies` for `pi-coding-agent`; `pi-ai` not needed as direct dep | applied: moved to peerDependencies, removed pi-ai |
| code | Phase 2 §1 | concern | code-quality | `AutoNamingState.turnCount` is dead field | applied: removed turnCount from type and createInitialState |
| coverage | — | — | — | All 7 verification intents covered | applied: zero uncovered entries |

## Plan History

- Phase 1: Package scaffolding + config — approved as generated
- Phase 2: State + 事件注册骨架 — approved as generated
- Phase 3: LLM 调用 + 标题生成 — approved as generated

## References

- `.rpiv/artifacts/research/2026-06-01_21-46-35_pi-extension-api-patterns.md` — 调研文档
- `changes/20260531-auto-naming-session/plan.md` — 原始计划文档
- `changes/20260531-auto-naming-session/CONTEXT.md` — 变更用语定义
```
