# 类似 pi 插件/扩展的对话总结与刷新机制调研

> **调研日期**：2026-07-15
> **调研背景**：在审查 `auto-naming-session` 插件功能正确性时，发现已有的各 agent 命名机制对照（见 [session-naming-across-agents.md](./session-naming-across-agents.md)）覆盖的主要是"一次性命名"机制，缺少对**周期性/事件性地总结对话进展**这类功能的深入对照。本调研重点补充 omp recap 功能的源码级分析，并扫描 pi 插件生态中类似的"对话总结/刷新"类扩展。
>
> **关联调研**：[session-naming-across-agents.md](./session-naming-across-agents.md)、[auto-naming-transcript-cost.md](./auto-naming-transcript-cost.md)
>
> **调研方法**：源代码阅读 + pi CLI/NPM/GitHub 搜索 + 本地包审查

---

## 目录

1. [omp recap 机制源码级分析](#1-omp-recap-机制源码级分析)
2. [pi 插件生态中的相似功能](#2-pi-插件生态中的相似功能)
3. [关键问题对照：omp recap vs auto-naming-session](#3-关键问题对照)
4. [对 auto-naming-session 决策的影响](#4-对-auto-naming-session-决策的影响)
5. [文件索引](#5-文件索引)

---

## 1. omp recap 机制源码级分析

### 1.1 概述

omp（oh-my-pi）的 recap 功能是 **idle 触发、瞬时显示、不持久化**的对话状态摘要。它于用户离开后返回时在状态栏显示一条简短的对话进展总结。

### 1.2 触发链

```text
agent_end → handleAgentEnd → finishAgentEnd → scheduleIdleRecap()
  ↓
setTimeout (默认 240 秒 idle)
  ↓
timer 触发 → runIdleRecap()
  ↓
runEphemeralTurn(recapPrompt)   ← 通过 side channel 临时调用 LLM
  ↓
回复到达 → showStatus("※ recap: <文本>")
```

**源码位置**（`event-controller.ts`）：

- `agent_end` handler → 第 1056 行
- `#finishAgentEnd` → 第 1071 行
- `#scheduleIdleRecap` → 第 1115 行、第 1414 行
- `#runIdleRecap` → 第 1440 行

**关键 gate**：若 session 正在流式输出（`isStreaming`），跳过 recap 调度（第 1066 行），防止被取代的旧 turn 调度。

### 1.3 LLM 输入

**recap 请求使用完整的对话上下文**，与主回合复用相同的 system prompt + 工具列表，只是额外追加了两层：

1. **标准转换管道**：`convertMessagesToLlm(snapshot)` 将当前完整消息历史（`[...this.messages]`）转换为 LLM 消息格式
2. **system prompt**：通过 `buildSideRequestContext(llmMessages)` 复用主 agent 的完整 system prompt + 工具目录（即便工具标记为不可用），确保提示缓存命中
3. **recap prompt**：渲染后的 `recap-user.md` 模板作为虚拟 user 消息追加

**recap prompt 模板**（`recap-user.md` 第 1-13 行）：

```text
The user stepped away and is coming back. Recap in under 40 words, 1-2 plain sentences, no markdown.
Lead with the overall goal and current task, then the one next action.
Skip root-cause narrative, fix internals, secondary to-dos, and em-dash tangents.
{{#if goal}}
Overall goal: {{goal}}
{{/if}}
{{#if task}}
Active task: {{task}}
{{/if}}
```

**变量来源**（`event-controller.ts` 第 1445-1448 行）：

- **`goal`**：来自 `#idleRecapGoalText()`（第 1473-1476 行），优先取 goal mode 的 `goal.objective`，若无则用 session title
- **`task`**：来自 `nextActionableTask(this.ctx.todoPhases)?.content`（第 1447 行），即 todo 列表中第一个未完成的任务

**side-channel-no-tools.md**（`side-channel-no-tools.md` 第 1-6 行）：
随 recap 发送的 tool 不可用提醒，内容为"工具目录仅供保持缓存温度，本回合不可用"。

**关键差异**：不是用"对话弧线 transcript"，而是用 **goal/task 结构化字段**驱动 LLM 总结方向。

### 1.4 持久化策略

**recap 输出完全不持久化。** 它是 ephemeral side-channel turn：

- 回复到达后通过 `this.ctx.showStatus(...)` 显示（第 1457 行）
- 格式：`theme.fg("dim", theme.italic("※ recap: <文本>"))` — dim + italic 样式
- 截断 280 可见字符（`TRUNCATE_LENGTHS.RECAP`，`render-utils.ts` 第 81 行）
- 新消息、转场或下一个 agent_end 时消失

**如何避免 cursor/状态问题**：

- 使用 `#idleRecapAbort`（AbortController）使运行中的 LLM 请求可被随时取消（第 94 行）
- 回复到达后重新检查 `#idleConditionsHold()`（第 1454 行），防止过时的 recap 覆盖新工作
- `#cancelIdleRecap()`（第 1373 行）在**任何**活动发生时清除 timer 并 abort 运行中的请求

### 1.5 模型选型

**recap 使用当前 session 的主模型，没有单独的模型配置。**

从 `runEphemeralTurn`（`agent-session.ts` 第 15267-15268 行）：

```typescript
const model = this.model;
if (!model) { throw new Error("No active model on session"); }
```

- 使用 `this.#sideStreamFn`（默认 `streamSimple`）（第 15300 行）
- 继承 reasoning 级别（`toReasoningEffort(this.thinkingLevel)`，第 15288 行）
- 使用 `prepareSimpleStreamOptions`（第 15275 行）应用 session 级别的 stream hooks

**与 auto-title 对比**：auto-title 有 `providers.tinyModel` 配置和专用的 `getTitleModel` 角色选择（`title-generator.ts` 第 44 行），按 `["tiny", "commit", "smol"]` 角色选择模型，最大 token 限制 1024。

### 1.6 显示方式

- 状态栏（status line）显示
- 格式：`※ recap: <文本>`（dim + italic）
- 截断：280 可见字符宽度
- 非持久化——新互动时消失

### 1.7 取消机制

**触发取消的场景**（全部触发 `#cancelIdleRecap`，第 1373-1381 行）：

1. 新 turn 开始（`handleTurnStart`，第 385 行）
2. dispose（第 198/290 行）
3. compaction 开始/结束（第 1161/1194 行）
4. 同时调度自身（第 1415 行 `scheduleIdleRecap` 开头清除旧 timer）

### 1.8 容错处理

在 `agent-session.ts` 第 15319-15322 行，`runEphemeralTurn` 的 `done` 事件处理中：

```typescript
// crash the recap turn with ... Normalize to `[]` so the recap surfaces an empty reply
// instead of turning a malformed side-channel response into a session-mute crash.
const rawContent = Array.isArray(event.message.content) ? event.message.content : [];
```

对 issue #4323 的修复：将 `content: undefined` 规范化为空数组，防止会话静默崩溃。

### 1.9 文件清单

| 文件 | 行号 | 作用 |
|------|------|------|
| `packages/coding-agent/src/prompts/system/recap-user.md` | 1-13 | recap prompt 模板（含 goal/task 变量） |
| `packages/coding-agent/src/modes/controllers/event-controller.ts` | 24, 52-53, 91-94, 198, 290, 385, 1056-1117, 1161, 1194, 1373-1381, 1414-1476 | 完整触发链、取消机制、执行 |
| `packages/coding-agent/src/session/agent-session.ts` | 15256-15355 | `runEphemeralTurn`（side-channel pipeline） |
| `packages/coding-agent/src/session/agent-session.ts` | 15319-15322 | 容错：`content: undefined` → `[]` |
| `packages/coding-agent/src/prompts/system/side-channel-no-tools.md` | 1-6 | tool 不可用提醒 |
| `packages/coding-agent/src/config/settings-schema.ts` | 1766-1789, 5152-5155, 5307 | `recap.enabled`、`recap.idleSeconds` |
| `packages/coding-agent/src/tools/render-utils.ts` | 80-81, 114-116 | `TRUNCATE_LENGTHS.RECAP = 280` |
| `packages/agent/src/agent.ts` | 697-728 | `buildSideRequestContext`（复用 system prompt + tools） |
| `packages/coding-agent/test/modes/controllers/event-controller-idle-compaction.test.ts` | 136-268 | recap e2e 测试 |
| `packages/coding-agent/test/session-stop-continuation-recap.test.ts` | 1-94 | recap 容错回归测试（#4323） |

---

## 2. pi 插件生态中的相似功能

### 2.1 搜索范围

| 来源 | 说明 |
|------|------|
| pi 官方 CLI（`pi list`） | 本地已安装的扩展 |
| pi 官方扩展示例 | `examples/extensions/` 下所有示例 |
| pi 官方文档与事件生命周期 | `README.md` + `docs/extensions.md` |
| 本地 `pi-extensions` 仓库 | `packages/` 下 5 个包（含本插件） |
| npm registry | `pi-extension`, `pi-package` 等关键词 |
| 全局已安装 npm 包 | `ls /home/cnife/.pi/agent/npm/node_modules/` |

### 2.2 一级匹配：周期性总结/刷新类

#### 2.2.1 `@cnife/pi-agent-loop-reflection`

| 项目 | 内容 |
|------|------|
| **描述** | 长 agent loop 中每 N 个有效 turn 自动插入反思提醒（steer 消息） |
| **事件** | `turn_end` 事件计数，仅 stopReason=toolUse 才递减 |
| **周期性** | 配置 `reminderTurnsInterval`（默认 10） |
| **触发点** | 每 N 个工具调用后的 assistant turn |
| **输出** | 通过 `pi.sendUserMessage()` 发送中文反思三问（目标、进展、下一步） |
| **源码** | `/home/cnife/personal_code/pi-extensions/packages/agent-loop-reflection/extensions/index.ts` |

**与 auto-naming-session 对比**：

- **相同**：N-turn 周期、有持久化配置、用事件循环计数、跳过重复触发
- **不同**：auto-naming-session 刷新**标题**，agent-loop-reflection 刷新**agent 方向确认**（更贴近"对话进展刷新"本质）

#### 2.2.2 `@cnife/pi-obsidian-diary`（已弃用）

| 项目 | 内容 |
|------|------|
| **描述** | 将会话总结写入 Obsidian 日记条目 |
| **状态** | `[Deprecated]` 标记 |
| **相关点** | 从 session branch 提取对话 → LLM 总结 → 写出，与 auto-naming-session 数据流同族 |

#### 2.2.3 `custom-compaction.ts`（pi 官方示例）

| 项目 | 内容 |
|------|------|
| **描述** | 替换默认 compact 行为：所有消息用 LLM 总结后只保留摘要 |
| **事件** | `session_before_compact` 事件中拦截 |
| **LLM** | 用 Gemini Flash（更便宜的小模型） |
| **输出** | 结构化摘要（目标、决策、代码变更、下一步清单） |
| **源码** | `/home/cnife/github_code/pi/packages/coding-agent/examples/extensions/custom-compaction.ts` |

**相关点**：这是 pi 生态中最完整的"对话总结"实现，但触发点不同（token 阈值 vs turn 计数）。

#### 2.2.4 `summarize.ts`（pi 官方示例）

| 项目 | 内容 |
|------|------|
| **描述** | `/summarize` 命令，手动触发当前对话摘要显示 |
| **事件** | 命令注册，非自动 |
| **输出** | 自定义 TUI 面板展示摘要 |
| **源码** | `/home/cnife/github_code/pi/packages/coding-agent/examples/extensions/summarize.ts` |

### 2.3 三级匹配：间接相关

| 包名 | 相关点 | 差异 |
|------|--------|------|
| `@juicesharp/rpiv-advisor` | 工作模型把完整对话发给更强模型做审查/指导 | 被动请求，非周期性 |
| `pi-invisible-continue` | 透明地继续 agent loop（不注入新消息） | 不总结，只复现 |
| `@ayulab/pi-rewind` | `/rewind` 检查点导航 | 检查点，非总结 |
| `@mjakl/pi-subagent` | 子 agent 委托，可并行执行 | 不直接总结，但可用于实现总结流程 |

### 2.4 关键发现

1. **`agent-loop-reflection` 是最匹配** — 它与 `auto-naming-session` 共享同一 N-turn 计数模式，但功能是**方向反思**而非改标题，本质上是**周期性对话进展刷新**。

2. **所有周期性刷新都使用同一事件组合**：`turn_end`/`agent_end` + 计数器状态。这是 pi 生态中实现"隔 N 个 turn 做事"的标准模式。

3. **pi 的 compaction 框架本身就是为总结/压缩设计的**，只是触发点不同（token 阈值 vs turn 计数）。

4. **NPM 搜索结果有限** — pi 插件生态还很小，总结/刷新类功能集中在 `@cnife` 包和官方示例中。

---

## 3. 关键问题对照

### 3.1 omp recap vs auto-naming-session 总对照表

| 维度 | omp recap | auto-naming-session |
|------|-----------|---------------------|
| **触发时机** | `agent_end` 后的 **idle 超时**（默认 240 秒） | 收到首条消息（`message_end`）+ 每 N turn（`agent_end`） |
| **持久化** | **瞬时（ephemeral）** — 状态栏显示，不写存储 | **持久化** — `setSessionName()` 写 session 标题槽位 |
| **LLM 输入** | 完整会话历史 + 完整 system prompt + goal/task 结构化字段 | 增量 transcript（自光标起） + 紧凑 system prompt |
| **输入控制** | goal 来自 goal mode 状态，task 来自 todo 列表 | 无外部结构化字段，LMM 自己从 transcript 提取"整体弧线" |
| **模型** | **主模型**（`this.model`），无专门配置 | `ctx.model` 或 `config.model`，有时是昂贵主模型 |
| **system prompt 复用** | 完整复用主 agent system prompt（含工具目录） | 专用标题 system prompt（`title-system.md`） |
| **取消机制** | **完善** — AbortController + idle 条件重检查 | **无** — 一次性请求，无取消路径 |
| **输出用途** | 用户回归时的即时上下文提醒 | 会话列表和终端标题 |
| **成本特征** | 每次 idle 触发，成本可节流（更长 idle 间隔） | 每次周期刷新固定成本 |

### 3.2 omp recap 的"无状态"方案 vs auto-naming-session 的"有状态"方案

omp recap 的 **ephemeral side-channel turn**（`agent-session.ts` 第 15256 行起）是决定性架构差异：

- recap 每次从 `this.messages` 复制完整快照，**无 cursor、无增量状态**
- 意味着它**从根本上免于 auto-naming-session 面临的 cursor 重放 bug 类**
- auto-naming-session 的增量设计（需要 cursor 追踪哪些消息已命名）是**状态复杂性的根源**

### 3.3 如果 auto-naming-session 采用 ephemeral 方案会怎样？

分析发现，auto-naming-session 的周期性全弧线刷新**不能直接采用 ephemeral**，原因：

- **持久化需求**：标题是长期可见的元数据（会话列表、标签），必须 `setSessionName()` 持久化
- **写操作**：ephemeral turn 的设计目标是"只读不写"——它不持久化 entry，避免了 cursor 问题，所以能无状态
- **但标题刷新是写操作**：每次刷新要调用 `setSessionName()` 覆盖旧标题——这仍然是持久化写，需要 cursor 管理

**结论**：omp recap 的 ephemeral 方案无法直接移植。auto-naming-session 需要自己的 cursor 管理方案，不能通过变成无状态来解决问题。

### 3.4 思考（thinking）是否纳入

- omp recap 的 `runEphemeralTurn` （`agent-session.ts` 第 15356 行）使用 `#buildEphemeralSnapshot`，它复制包含正在流式 assistant 消息（`protectThinkingBlocks`）的消息列表——即 recap 请求**包含 thinking block**
- 这与实际总结质量相关：recap 可能受益于看到 assistant 的推理过程来生成更准确的进展摘要
- 但 auto-naming-session 的 `buildTranscript` 目前只取 `.text` 类型，丢弃 thinking/toolCall
- 这个差异可留到 grilling 时讨论

---

## 4. 对 auto-naming-session 决策的影响

### 4.1 cursor bug 修复方向

- omp recap 的 ephemeral 方案**不能直接复用**（auto-naming-session 需要持久化写入）
- 但可在现有修复方案中引入类似 **AbortController 取消机制**（目前 auto-naming-session 没有取消路径）
- `agent-loop-reflection` 的计数方式（`turn_end` + 仅 toolUse 递减）可能比 `agent_end` 计数更精确

### 4.2 transcript 收集范围

- omp recap 每次发**全量快照**（`[...this.messages]`），不走增量
- 但 recap 是用**结构化字段（goal/task）**替代了 transcript 摘要——这提供了一个不同思路
- auto-naming-session 也可以用 `title_generation/` 目录下的用户自定义文件提供类似的结构化输入

### 4.3 模型选型

- omp recap **用主模型**（与 auto-naming-session 不一致的发现）
- 但 recap 设计目标不同（即时性、跟随最新状态），而标题生成只需要"概括"
- `custom-compaction.ts` 用 Gemini Flash（更快更便宜的模型）——这是标题生成更好的对标

### 4.4 触发时机

- omp recap 的 **idle 触发**和 auto-naming-session 的 **turn-count 触发**各有利弊
- idle 触发更适合"用户可能看到"时刷新；turn-count 触发更适合"对话状态变化"时刷新
- 从功能性角度看，auto-naming-session 的 turn-count 触发仍然合理

---

## 5. 文件索引

### 关键源代码

| 文件 | 说明 |
|------|------|
| `~/github_code/oh-my-pi/packages/coding-agent/src/prompts/system/recap-user.md` | omp recap 提示词模板 |
| `~/github_code/oh-my-pi/packages/coding-agent/src/modes/controllers/event-controller.ts` | omp recap 触发/取消/执行链 |
| `~/github_code/oh-my-pi/packages/coding-agent/src/session/agent-session.ts` | omp `runEphemeralTurn` 实现 |
| `~/github_code/oh-my-pi/packages/coding-agent/src/config/settings-schema.ts` | omp recap 配置 schema |
| `~/github_code/pi/packages/coding-agent/examples/extensions/custom-compaction.ts` | pi 官方对话总结示例 |
| `~/github_code/pi/packages/coding-agent/examples/extensions/summarize.ts` | pi 官方手动摘要示例 |
| `packages/auto-naming-session/extensions/index.ts` | 被审查的 auto-naming-session 插件 |
| `packages/agent-loop-reflection/extensions/index.ts` | agent-loop-reflection 插件（最接近的对照） |

### 已产出调研文档

| 文档 | 说明 |
|------|------|
| `docs/research/similar-pi-extensions.md` | 本文：类似功能的周期总结/刷新机制调研 |
| `docs/research/session-naming-across-agents.md` | 各 agent 命名机制对照 |
| `docs/research/auto-naming-transcript-cost.md` | 全量 vs 增量 transcript 的 token 成本测量 |

---

---

## 6. 第三方 pi 会话命名插件对照分析

> **调研方法**：从 npm `pi-package` 生态中检索到 6 个与会话自动命名直接相关的包（经 796 候选 → 90 硬过滤 → 6 精确命中），逐一克隆 GitHub 仓库进行源码级分析。
> 所有结论基于源代码，附文件路径与行号。

### 6.1 总览

| # | 包名 | 类型 | 月下载 | ⭐ | 自动/手动 | 是否周期刷新 | 模型选型 | 重放保护机制 |
|---|------|------|--------|---|----------|-------------|----------|-------------|
| 1 | `pi-session-name` | package | 89 | 1 | 自动·一次性 | ❌ | 主模型 | 无 |
| 2 | `@d3ara1n/pi-session-namer` | extension | 1,144 | 3 | 自动·一次性 | ❌ | 侧智能体（`utility` 角色） | `hasNamed` 同步标记 |
| 3 | `pi-autoname` | package | 1,139 | 3 | 自动·周期 | ✅（冷却 10 分钟） | 备用链（主→备用→会话→兜底） | 序列计数器 + 状态条目恢复 |
| 4 | `@agnishc/edb-auto-name-session` | extension | 404 | 16 | 自动·一次性 | ❌ | 硬编码 `opencode/big-pickle` | `sessionToken` 失效 |
| 5 | `@ryan_nookpi/pi-extension-auto-name` | package | 264 | 18 | 自动·一次性 | ❌ | 可配置（默认主模型） | 仅 `getSessionName()` guard |
| 6 | `@gotgenes/pi-session-tools` | extension | 559 | 84 | **手动**（工具驱动） | ❌ | 无 LLM 调用 | 不适用 |

---

### 6.2 各包详细分析

#### 6.2.1 `pi-session-name`（ttttmr）

**源码位置**：`/tmp/review-pi-session-name/src/index.ts`（单文件，68 行）

| 维度 | 详细信息 |
|------|----------|
| **LLM 输入** | 硬编码 prompt（第 5-11 行）+ 仅 `firstPrompt`（`event.text.trim()`，第 39 行）。无对话历史、无 toolCall/thinking |
| **持久化** | `pi.setSessionName(part.text)`（第 59 行）+ `ctx.ui.setTitle()` 更新终端标题（第 17-19 行）。无 cursor/状态管理 |
| **触发** | `input` 事件（第 37 行），仅第一条用户消息。守卫：`if (pi.getSessionName()) return;`（第 38 行）——绝不覆盖已有名称 |
| **模型** | 主模型 `ctx.model`（第 41 行），`maxTokens: 24`（第 53 行）。无独立模型配置 |
| **显示** | 两者皆有：`setSessionName` 改会话标题 + `ctx.ui.setTitle` 改终端标题（格式 `· <名称> - <cwd>` / `✳ <名称> - <cwd>`） |
| **重放保护** | ❌ 无持久化状态。仅 `started` 内存标志位防止重复。热重载后可能重新触发 |
| **关键差异** | 锁定第一条消息永不刷新；68 行极简实现；硬编码 prompt 无配置 |

#### 6.2.2 `@d3ara1n/pi-session-namer`

**源码位置**：`/tmp/review-d3ara1n/packages/pi-session-namer/src/`（index.ts + namer.ts + config.ts + types.ts，~200 行）

| 维度 | 详细信息 |
|------|----------|
| **LLM 输入** | `buildNamerSystemPrompt()`（namer.ts 第 14-27 行）+ 仅 `event.prompt`（来自 `before_agent_start`），可截断至 2000 字符。无助手回复、无对话历史 |
| **持久化** | `pi.setSessionName(name)`（index.ts 第 87 行）。无终端标题更新。`hasNamed` 布尔标志位（仅内存，`session_start` 重置） |
| **触发** | `before_agent_start`（index.ts 第 38 行）——仅首次。同步设置 `hasNamed = true`（第 46 行）后再异步调用。`/namer:rename` 命令手动重命名 |
| **模型** | **侧智能体**（独立轻量模型，默认 `utility` 角色）——index.ts 第 70 行。可配置 `sessionNamer.sideAgentRole`（types.ts 第 20 行）。超时 10 秒 |
| **显示** | 仅 `pi.setSessionName()`。TUI 通知提示兜底/错误 |
| **重放保护** | ✅ `hasNamed` 在异步调用**之前**同步设置（第 46 行），防止 `before_agent_start` 重放时双重触发。`session_start` 检测已有名称（第 28-32 行） |
| **关键差异** | 唯一用**侧智能体**（独立廉价模型）的包；触发在 `before_agent_start`（agent 启动前）；无兜底质量检查 |

#### 6.2.3 `pi-autoname`（ssdiwu）

**源码位置**：`/tmp/review-pi-autoname/extensions/index.ts`（~400 行）+ `extensions/lib.ts`（~200 行）

| 维度 | 详细信息 |
|------|----------|
| **LLM 输入** | System prompt（index.ts 第 167 行）+ 动态 `buildNamingPrompt()`（第 176-205 行）。**两种模式**：首次对话（user + assistant 首条回复）/ 周期（最近 `maxMessages=6` 条消息）。各角色截断至 700 字符。隐私脱敏 `redactSensitiveText()`（第 197 行） |
| **持久化** | `pi.setSessionName(name)`（第 260 行）+ **自定义状态条目** `pi.appendEntry(STATE_ENTRY_TYPE, ...)`（第 268 行）。`session_start`（第 290-331 行）解析状态条目恢复命名状态。独立配置文件 `~/.pi/agent/pi-autoname.json` |
| **触发** | `session_start`（恢复状态）+ `agent_end`（第 333 行）处理两种场景：首次命名（`namingState === "unnamed"`，第 349 行）和周期刷新（冷却时间已过，第 360 行）。冷却时间默认 10 分钟可配。`/autoname` 手动 + `/name` 用户重命名检测（第 337-342 行） |
| **模型** | **备用链** `buildModelChain()`（第 221-248 行）：配置 model → fallbackModels[] → ctx.model → `smartFallbackName()`。质量检查 `isHighQualityName()`（lib.ts 第 55-60 行，长度 3-30 字符）。超时 30 秒 |
| **显示** | 仅 `pi.setSessionName()`。TUI 通知提示 |
| **重放保护** | ✅ **最完善的防护**：`namingSequence` 计数器（第 255-257 行）检测陈旧结果；自定义状态条目在 `session_start` 恢复状态；用户重命名检测重置冷却时间 |
| **关键差异** | 唯一同时支持**首次 + 周期刷新**的第三方包；唯一有**隐私脱敏**（6 种模式）和质量检查的包；`~600` 行最大实现 |

#### 6.2.4 `@agnishc/edb-auto-name-session`

**源码位置**：`/tmp/review-agnishc/packages/edb-auto-name-session/src/`（index.ts + title.ts）

| 维度 | 详细信息 |
|------|----------|
| **LLM 输入** | 硬编码英文 prompt（index.ts 第 10-27 行，Title Case / 2-6 词 / 幽默兜底）+ 仅首条用户消息纯文本（`extractUserText`，title.ts 第 13-28 行），截断至 4000 字符 |
| **持久化** | `pi.setSessionName(name)`（第 60 行）。无状态持久化。仅内存 `sessionToken` 计数器（第 32 行） |
| **触发** | `message_end` 事件，`armed` 标志位（第 48 行）确保仅首次触发。fire-and-forget 异步 |
| **模型** | **硬编码** `opencode/big-pickle`（第 7-8 行），通过 `ctx.modelRegistry.find()` 查找（第 71 行）。不可配置 |
| **显示** | 仅 `pi.setSessionName()` |
| **重放保护** | ✅ `sessionToken` 失效模式（第 33、37 行）：在 `session_start`/`session_shutdown` 递增，命名完成后检查 `token !== sessionToken` 则放弃（第 58 行）+ `getSessionName()` 二层检查（第 59 行） |
| **关键差异** | 唯一**硬编码模型 provider** 的包；Token 失效 + fire-and-forget 架构防止竞态；幽默兜底标题 |

#### 6.2.5 `@ryan_nookpi/pi-extension-auto-name`

**源码位置**：`/tmp/review-jonghakseo/packages/auto-name/`（index.ts + utils/）

| 维度 | 详细信息 |
|------|----------|
| **LLM 输入** | 韩语硬编码 system prompt（`auto-name-utils.ts` 第 17-18 行，20 字符以内目的提取）+ 首条用户消息截断至 500 字符（`buildNameContext()`，第 57-59 行） |
| **持久化** | `pi.setSessionName(name)`（index.ts 第 87 行）。设置持久化到 `~/.pi/agent/auto-name/settings.json`（modelId + thinkingLevel）。无会话状态持久化 |
| **触发** | `before_agent_start`（第 77-91 行）。守卫：跳过子 agent 会话 / 已有名称 / 空白 prompt。一次性 + fire-and-forget |
| **模型** | **可配置**：默认 `ctx.model`（第 29-37 行 `resolveModel()`），支持自定义 modelId（provider/model），运行时通过 `/auto-name:setting` 切换。支持传递 `reasoning` 参数。验证 `stopReason === "stop"` |
| **显示** | **三者皆有**：`setSessionName`（标题）+ `ctx.ui.setStatus(NAME_STATUS_KEY, ...)`（状态栏/索引.ts 第 49-55 行）+ `ctx.ui.setTitle`（终端标题 `"π - <name> - <cwd>"`，第 42-46 行） |
| **重放保护** | ❌ 仅 `getSessionName()` guard（第 80 行）。无 token/增量机制。`before_agent_start` 在恢复时可能再次触发 |
| **关键差异** | 唯一**韩语 system prompt** 的包；唯一支持 thinking 推理级别的包；唯一**三者全显示**（会话标题 + 状态栏 + 终端标题）的包 |

#### 6.2.6 `@gotgenes/pi-session-tools`

**源码位置**：`/tmp/review-gotgenes/packages/pi-session-tools/src/index.ts`

| 维度 | 详细信息 |
|------|----------|
| **LLM 输入** | **不适用**——不调用 LLM。注册 `set_session_name`、`get_session_name` 等工具而非事件处理 |
| **持久化** | 工具 `set_session_name` 调用 `pi.setSessionName(params.name)`（第 122-127 行）。手动操作，非自动 |
| **触发** | **无自动触发**。所有功能通过代理工具调用驱动。无 `pi.on(...)` 事件注册 |
| **模型** | 不适用——无 LLM 调用，直接读写会话元数据 |
| **显示** | 仅 `pi.setSessionName()` |
| **重放保护** | 不适用——手动工具调用，无自动触发循环 |
| **关键差异** | 不是自动命名器，是**多会话元数据工具包**（读/写/列 session 文件）。`set_session_name` 可用作自动命名器的后端钩子 |

---

### 6.3 横向对比总结

#### 6.3.1 LLM 输入策略

| 策略 | 使用包 | 说明 |
|------|--------|------|
| 仅首条用户消息 | pi-session-name、@d3ara1n/pi-session-namer、@agnishc/edb-auto-name-session、@ryan_nookpi/pi-extension-auto-name | 最简策略，忽略对话演化 |
| 首条对话（user + assistant） | pi-autoname（首次命名模式） | 比仅用户消息多了第一条回复的上下文 |
| 最近 N 条消息（窗口） | pi-autoname（周期刷新模式，maxMessages=6） | 唯一支持增量对话上下文的第三方包 |
| 无 LLM 调用 | @gotgenes/pi-session-tools | 工具包，纯手动 |

**与 auto-naming-session 对比**：auto-naming-session 的 transcript 收集是整个对话窗口（默认全量），相比之下大多数第三方包只首条消息。`pi-autoname` 的 6 条消息窗口是最接近的中等方案。

#### 6.3.2 模型选型策略

| 策略 | 使用包 |
|------|--------|
| 主模型（`ctx.model`） | pi-session-name、@ryan_nookpi/pi-extension-auto-name（默认） |
| 侧智能体（独立轻量模型） | @d3ara1n/pi-session-namer（`utility` 角色） |
| 备用链（主→备用→会话→兜底） | pi-autoname |
| 硬编码 provider/model | @agnishc/edb-auto-name-session（`opencode/big-pickle`） |
| 无 LLM | @gotgenes/pi-session-tools |

**与 auto-naming-session 对比**：auto-naming-session 有 `providers.tinyModel` 配置和 `getTitleModel` 角色选择，类似 @d3ara1n/pi-session-namer 的侧智能体思路但更灵活。pi-autoname 的备用链最完善。

#### 6.3.3 周期刷新支持

| 能力 | 使用包 |
|------|--------|
| 仅首次命名，永不刷新 | pi-session-name、@d3ara1n/pi-session-namer、@agnishc/edb-auto-name-session、@ryan_nookpi/pi-extension-auto-name |
| 周期刷新（冷却 10 分钟） | pi-autoname |
| 手动命令重命名 | @d3ara1n（`/namer:rename`）、pi-autoname（`/autoname`） |
| 用户重命名检测 | pi-autoname（检测 `/name` 覆盖） |

**与 auto-naming-session 对比**：auto-naming-session 的周期刷新（每 N turn）在第三方生态中极少见——只有 `pi-autoname` 支持类似能力，但用的是时间冷却而非 turn 计数。

#### 6.3.4 重放/竞态保护机制

| 保护机制 | 使用包 | 等级 |
|----------|--------|------|
| `getSessionName()` guard | 全部自动命名器 | ⭐ 基础 |
| 内存标志位（started/hasNamed/armed） | pi-session-name、@d3ara1n/pi-session-namer、@agnishc/edb-auto-name-session | ⭐⭐ 中等 |
| 同步设置标志位再异步调用 | @d3ara1n/pi-session-namer（第 46 行） | ⭐⭐ 中等 |
| Token 失效计数器 | @agnishc/edb-auto-name-session（`sessionToken`） | ⭐⭐⭐ 良好 |
| 序列计数器 + 状态条目恢复 | pi-autoname（`namingSequence` + 自定义 marker） | ⭐⭐⭐⭐ 最强 |

**与 auto-naming-session 对比**：auto-naming-session 面临的 cursor 增量重放 bug（预取旧 cursor）在第三方包中**没有直接对照**，因为大多数包要么只做一次性命名无需 cursor，要么用 token/sessionToken 做更简单的场景标记。pi-autoname 的 `namingSequence` 计数器是唯一与 cursor 问题类似的防护——但它防的是竞争条件（陈旧回调覆盖新状态），而非 cursor 增量一致性问题——后者是 auto-naming-session 独有的，因其需要追踪「哪些消息已被命名」和「持久化写入时使用哪个 cursor」两个独立状态。

> **调研结论**：第三方 pi 生态中没有与 `auto-naming-session` 完全对标（既做周期全弧线刷新、又需 cursor 增量管理）的实现。`pi-autoname` 是最接近的多能力包，但它用时间冷却而非 turn 计数。若为 `auto-naming-session` 的 cursor bug 寻找参考，`pi-autoname` 的 `namingSequence` 计数器和 `@agnishc/edb-auto-name-session` 的 `sessionToken` 失效模式最值得借鉴。
