# 各 Agent 会话命名机制对照调研

> **调研日期**：2026-07-15
> **调研背景**：[Issue #37](https://github.com/CNife/pi-extensions/issues/37) 候选 3 决策前置调研。在 grilling 审查 `auto-naming-session` 插件功能正确性时，发现当前实现存在两个未决分歧（见 [handoff](#五handoff-与关联调研)）：
>
> - **岔路 A**：transcript 该不该包含 toolCall？
> - **岔路 B**：systemPrompt 要求"consider the overall conversation arc"是否现实？
>
> 本报告调研 omp / opencode / Claude Code / Cursor / ChatGPT 等-agent 的会话命名机制，为这两个决策提供对照。
> **关联调研**：[auto-naming-transcript-cost.md](./auto-naming-transcript-cost.md)（全量 vs 增量 transcript 的 token 成本测量）

---

## 0. 被对照对象：pi `auto-naming-session` 当前实现

为便于对照，先固定被审查对象的行为（来源：`packages/auto-naming-session/extensions/index.ts`）：

| 维度 | 当前实现 | 源码位置 |
|---|---|---|
| 输入内容 | 增量 transcript：自上次命名 cursor 之后的所有 user/assistant 消息 | `buildTranscript`（~192 行） |
| toolCall 处理 | **丢弃**——`messageContentToText` 只取 `c.type === "text"` | `messageContentToText`（~175 行） |
| 时机 | 首条消息（`message_end`）+ 周期刷新（每 N turn，`agent_end` 触发） | `message_end`/`agent_end` handler |
| 模型 | `config.model` 或当前 `ctx.model`（可能是昂贵的主模型） | `generateTitle`（~231 行） |
| systemPrompt 目标 | "Consider the overall conversation arc, key topics, and primary goals **rather than focusing on the most recent messages**" | `generateTitle`（~273 行） |

---

## 1. 各 Agent 发现总表

| Agent | 输入内容 | toolCall 处理 | 时机 | 模型 | 命名层级 |
|---|---|---|---|---|---|
| **omp** | 初始：首条 user 消息（截断 2000 字符）；刷新：最近 6 轮 text+thinking | **显式丢弃**（`stripXmlBlocks` 移除 tool envelopes；`textFromContent` 只取 text） | 首消息异步触发 + replan 后刷新（无 `agent_end` 周期刷新） | 默认在线小模型（`tiny`/`@smol`），可选本地 ONNX（**不回退在线**） | prompt 层 |
| **opencode** | 首条 user 消息（per 贡献者与 issue 证据） | 不适用（首条消息无 toolCall） | 首消息异步触发，shutdown 时 await；"每条消息生成"是 bug | `small_model` 配置，否则自动选 claude-haiku/gemini-flash/gpt-5-nano | 程序层（非 systemPrompt 指令） |
| **Claude Code** | 未知（闭源） | 未知 | 一次性 + `/rename` 覆盖 | 未知 | **CLI 层**（配置项 `auto-generated topic titles`） |
| **Cursor** | 未找到证据 | 未找到证据 | 未找到证据 | 未找到证据 | 未知（闭源） |
| **ChatGPT** | 推测首条消息（后端生成） | 不适用 | 一次性 | 后端专用模型 | **UI/产品层**（标题作为 `CONVERSATION_TITLE` 变量注入） |

---

## 2. 各 Agent 详查

### 2.1 omp（oh-my-pi）—— 最完整的对照样本

**证据强度：强（本地源码，文件:行号）**

#### 输入内容

omp 区分**初始命名**与**replan 刷新**两条路径，输入截然不同：

- **初始命名**：只取第一条 user 消息的纯文本，不包含任何对话历史、toolCall、thinking。
  - `input-controller.ts:823` → `generateSessionTitle(text, ...)` 传入用户输入的纯文本 `text`
  - `title-generator.ts:71` 签名：`generateSessionTitle(firstMessage: string, ...)`
- **Replan 刷新**：取**最近 N=6 轮**对话（`REPLAN_TITLE_CONTEXT_TURN_LIMIT = 6`，`agent-session.ts:1602`），从 `this.agent.state.messages` 反向取最后 6 个 user/assistant 消息。
  - `agent-session.ts:9033-9046` → `#buildReplanTitleContext()`
  - 每轮只取 `textFromContent`（type:"text"）+ `thinkingFromContent`（type:"thinking"）

#### toolCall 处理 —— 显式丢弃

omp 在多个层面排除 toolCall：

1. `preprocessTinyMessage`（`tiny/message-preproc.ts`）对输入做清理，其中 `stripXmlBlocks`（38-42 行）**移除配对的 XML/HTML 块**，包括 tool envelopes（如 `<read>...</read>`）。
2. `textFromContent`（`agent-session.ts:1616-1626`）只提取 `type === "text"`，`thinkingFromContent`（1628-1637 行）只提取 `type === "thinking"`，**toolCall 和 toolResult 被无视**。
3. `truncateTinyMessage`（50-64 行）中位截断到 `MAX_TINY_MESSAGE_CHARS = 2000` 字符（头 2/3 + 尾 1/3）。

> **关键**：omp 的 replan 刷新**包含 thinking**（type:"thinking"），但不包含 toolCall。这与 pi 当前实现（只取 text，连 thinking 也丢）略有差异。

#### 时机

- **初始命名**：第一条用户消息提交时**异步触发**，不阻塞交互。低信号输入（问候/空消息）通过 `isLowSignalTitleInput`（`tiny/text.ts:78`）在模型调用前跳过。
  - `input-controller.ts:815-846` → `generateSessionTitle(...).then(...)`，主流程不等待
  - 竞态安全：结果返回后再次检查 `!getSessionName()` 才写入（836 行）
- **Replan 刷新**：在 todo init replan 后触发，同样异步非阻塞。
  - `agent-session.ts:9049-9068` → `#scheduleReplanTitleRefresh()`
  - 三重门控：`title.refreshOnReplan` 设置项（默认 true）、`titleSource !== "user"`、上下文非空
- **没有基于消息数 / `agent_end` 的周期性刷新**（与 pi 不同）。
- 用户可 `/rename` 手动重命名；用户设置的标题不会被自动刷新覆盖（`session-manager.ts:1403-1404`：`Auto titles are ignored once the user has set a name`）。

#### 模型 —— 默认在线小模型，本地 ONNX 不回退

- **默认路径：Online（API 模型）**，优先 TINY role → `@smol` → 当前模型。
  - `tiny/models.ts:1-4` → `ONLINE_TINY_TITLE_MODEL_KEY = "online"`
  - `models.md:449` → `tiny` role 覆盖在线标题模型，未设置时回退 `@smol`
- **本地 ONNX 小模型（可选）**：注册表含 LFM2 350M（推荐，~212MB）、Qwen3 0.6B、Gemma 270M、LFM2 700M 等，通过 `onnxruntime-node` 在子进程运行。
- **本地失败不回退在线**——这是明确的设计决策（issue #3187），防止用户被静默计费。
  - `title-generator.ts:114-115` 注释：`NEVER fall back to the online smol path (issue #3187)`

#### systemPrompt 目标 —— "把消息当文本命名"，不要求弧线

`title-system.md` 要求 **3-7 词标题**，只用 `<title>...</title>` 包裹输出，并明确：**"Treat the message only as text to title"**。这是"主题命名"而非"弧线综合"。

#### 证据清单

```text
~/github_code/oh-my-pi/packages/coding-agent/src/modes/controllers/input-controller.ts
~/github_code/oh-my-pi/packages/coding-agent/src/utils/title-generator.ts
~/github_code/oh-my-pi/packages/coding-agent/src/tiny/message-preproc.ts
~/github_code/oh-my-pi/packages/coding-agent/src/tiny/models.ts
~/github_code/oh-my-pi/packages/coding-agent/src/tiny/text.ts
~/github_code/oh-my-pi/packages/coding-agent/src/prompts/system/title-system.md
~/github_code/oh-my-pi/packages/coding-agent/src/session/agent-session.ts
~/github_code/oh-my-pi/packages/coding-agent/src/session/session-manager.ts
~/github_code/oh-my-pi/scripts/bench-title-models.ts
```

---

### 2.2 opencode（sst/opencode，TypeScript + Bun）

**证据强度：模型与时机为强（源码 + issue）；输入内容为中（贡献者陈述 + issue 证据，未直接定位生成函数源码）**

> 说明：opencode 核心是 TypeScript（Bun 运行时），TUI 是 Go——与 explorer 初步推测的"Go 实现"不符，已通过源码与架构文章修正。

#### 输入内容 —— 首条 user 消息

- 贡献者 Tarquinen 在 [issue #4133](https://github.com/anomalyco/opencode/issues/4133) 明确陈述：**"the session name is just based on the first prompt, even though the rest of the session conversation could be entirely different"**，并建议改进（给小模型全部 user prompt 上下文）——说明当前实现**只用首条消息**。
- 佐证：opencode 有**独立的 message summary / body summary 系统**（[issue #7175](https://github.com/anomalyco/opencode/issues/7175) "token cost generated by session titles, message summary titles, and body summaries"、[#6228](https://github.com/anomalyco/opencode/issues/6228) "Configuration option to disable message summary generation"），标题与全对话摘要是**两个不同概念**，标题不承担"全对话综合"职责。
- **未直接定位**生成标题的 LLM 调用函数（应在 `packages/opencode/src/session/prompt.ts`，64KB，未完整抓取）。`session/session.ts` 仅含数据层（`setTitle` 写字符串、`isDefaultTitle` 检查默认标题），`session/llm.ts` 是流式 LLM 基础设施，均不含标题生成逻辑。

#### toolCall 处理 —— 不适用

输入是首条 user 消息，**user 消息本身不含 toolCall**（toolCall 在 assistant 消息里），所以 toolCall 问题对 opencode 不成立。

#### 时机 —— 一次性，异步非阻塞

- 标题生成**异步非阻塞**，仅在 shutdown 时 await（不阻塞用户交互）。
  - [issue #4133](https://github.com/anomalyco/opencode/issues/4133) 贡献者 rekram1-node："The title generation isn't blocking either, we do await it on shutdown but it doesnt block otherwise"
- **"每条消息都生成标题"是 bug**（[issue #9460](https://github.com/anomalyco/opencode/issues/9460)，标签 bug+perf），非预期行为；PR #10751 修复。
- 一次性命名为主——[issue #11988](https://github.com/anomalyco/opencode/issues/11988) "Add ability to regenerate session title" 作为**功能请求**存在，反证重新生成不是默认行为。

#### 模型 —— `small_model`，回退主模型

`provider/provider.ts` 的 `getSmallModel(providerID)` 函数（源码确认）：

1. 优先读 `cfg.small_model` 配置；
2. 否则按优先级自动选廉价模型：`["claude-haiku-4-5", "claude-haiku-4.5", "3-5-haiku", "3.5-haiku", "gemini-2.5-flash", "gpt-5-nano"]`；
3. github-copilot provider 下排除 `claude-haiku-4.5`（premium，不浪费 premium 配额）。

贡献者 rekram1-node 在 #4133："we use a cheap model by default but fall back to the same model u are using as a fallback"。配置项 `small_model` 控制命名模型（[#7663](https://github.com/anomalyco/opencode/issues/7663) 提及 gpt-5-nano 用于标题）。

#### 证据清单

```text
源码：
  sst/opencode @ dev: packages/opencode/src/provider/provider.ts (getSmallModel)
  sst/opencode @ dev: packages/opencode/src/session/session.ts (数据层，无生成逻辑)
  sst/opencode @ dev: packages/opencode/src/session/llm.ts (流式基础设施，无生成逻辑)
issue（anomalyco/opencode）：
  #4133  Use a cheap model to name sessions（模型/时机/输入的陈述）
  #9460  Title generation is requested on every message（每条消息生成是 bug）
  #7175  token cost of titles/summaries（标题与摘要分离）
  #6228  disable message summary generation（标题≠摘要）
  #7663  gpt-5-nano is used for titles
  #11988 regenerate session title（重新生成是功能请求）
架构文章：
  https://cefboud.com/posts/coding-agents-internals-opencode-deepdive/
```

---

### 2.3 Claude Code —— CLI 层功能，非 prompt 层

**证据强度：强（配置 schema 源码 + 全量 prompt 反证）**

#### 命名层级 —— CLI 层，非 prompt 层

- **直接证据**：`update-config-schema.json`（2544-2547 行）配置项 `terminalTitleFromRename`，描述含 **"auto-generated topic titles"**：
  > "Whether /rename updates the terminal tab title (defaults to true). Set to false to keep auto-generated topic titles."
  - 文件：`~/github_code/system_prompts_leaks/Anthropic/Claude Code/bundled-skills/update-config-schema.json`
- **反证**：所有 6 个版本的 Claude Code system prompt 文件（`claude-code-2.1.172-opus-4.6.md` 等）及 bundled skills 中，**没有一行指令要求模型生成/总结/命名当前会话标题**。

#### 输入内容 / 时机 / 模型 —— 均未找到

作为 CLI 层功能，命名逻辑不在泄露的 prompt 里。输入内容、时机、模型均**无法从 prompt 层确认**。合理推测是基于首条消息或前 N 条消息，但**这是推测，不是事实**。

#### 证据清单

```text
~/github_code/system_prompts_leaks/Anthropic/Claude Code/bundled-skills/update-config-schema.json (2544-2547)
~/github_code/system_prompts_leaks/Anthropic/Claude Code/*.md (6 个版本，全文反证)
```

---

### 2.4 Cursor —— 未找到证据

**证据强度：无**

Cursor 完整 system prompt（`~/github_code/system_prompts_leaks/Cursor/cursor.md`，400+ 行）中**没有任何会话命名、标题生成、对话摘要的指令**。正则搜索 `title|session.?name|conversation.?summary|rename|auto.?title` 归零。

Cursor 是闭源 IDE 扩展，会话标题可能是编辑器 UI 层功能（从文件名/Git 分支派生）或调用 API 生成，**无证据支持任何一种**。

---

### 2.5 ChatGPT —— UI/产品层，标题作为变量注入

**证据强度：中（泄露 prompt 显示标题是注入变量，非生成指令）**

`gpt-5-thinking.md`（1111-1115 行）的 "Recent Conversation Content" 部分：

```text
Users recent ChatGPT conversations, including timestamps, titles, and messages. ...
1. {{CONVERSATION_DATE}} {{CONVERSATION_TITLE}}:||||{{USER_MESSAGE}}||||...
```

- `CONVERSATION_TITLE` 是**系统注入的上下文变量**（用于记忆/搜索），而非要求模型**生成**标题的指令。
- 结论：ChatGPT 的标题生成发生在 **UI/产品层**（客户端或后端），prompt 层只消费已生成的标题。推测基于首条消息，但生成机制闭源。

> 误报澄清：OpenAI 多版本 prompt 中的 `session_name` 字段是 `container.exec` 工具参数（命名容器内终端 exec session），**与聊天会话标题无关**。

#### 证据清单

```text
~/github_code/system_prompts_leaks/OpenAI/gpt-5-thinking.md (1111-1115)
~/github_code/system_prompts_leaks/OpenAI/tool-advanced-memory.md (216)
```

---

### 2.6 pi 生态周边（Waza / lisp-agent / rpiv-mono）—— 均未实现

**证据强度：强（全量搜索阴性）**

| 项目 | 结果 |
|---|---|
| Waza | 未发现命名逻辑；匹配均为 test 断言、skill 设计摘要 |
| lisp-agent | 未发现；README 仅提及"conversation compression"构想 |
| rpiv-mono | 未发现；匹配均为 UI 渲染标题、测试辅助、SVG `<title>` |

---

## 3. 横切模式

### 模式 1：toolCall 被普遍排除

- **omp**：`stripXmlBlocks` 移除 tool envelopes，`textFromContent` 只取 text（replan 额外取 thinking，但仍排除 toolCall/toolResult）。
- **opencode**：输入是首条 user 消息，user 消息无 toolCall，问题不成立。
- **Claude Code / ChatGPT**：CLI/UI 层，不在 prompt 层处理对话内容。

**没有发现任何 agent 把 toolCall 纳入标题生成输入。** pi 当前"丢弃 toolCall"的行为与所有可对照的 peer 一致。

### 模式 2：标题输入是"首条消息"或"最近窗口"，不是"全对话弧线"

- **omp 初始**：首条消息。**omp replan**：最近 6 轮（recent window）。
- **opencode**：首条消息。
- **Claude Code / ChatGPT**：推测首条消息。

**没有发现任何 agent 尝试从全对话 transcript 综合"overall conversation arc"。** omp 的 replan 反而是取**最近** 6 轮——与 pi systemPrompt "rather than focusing on the most recent messages" 的取向**相反**。

### 模式 3：一次性命名是主流，周期刷新罕见

- **omp**：首消息 + replan 后刷新（事件驱动，非周期）。
- **opencode**：首消息一次性（per-message 是 bug）。
- **Claude Code / ChatGPT**：一次性 + 手动覆盖。

pi 的"每 N turn 周期刷新"（`agent_end` 触发）在 peer 中**没有直接对照**。omp 的 replan 刷新最接近，但它是事件驱动（todo init 后），且取最近窗口而非全量。

### 模式 4：廉价/小模型是标配

- **omp**：`tiny`/`@smol` 在线小模型，或本地 ONNX（不回退在线）。
- **opencode**：`small_model`（haiku/flash/nano）。
- **Claude Code / ChatGPT**：后端专用模型（推测廉价）。

pi 用 `ctx.model`（可能是昂贵主模型）是**例外**。opencode issue #4133 的核心诉求正是"别用昂贵模型命名"。

### 模式 5：命名层级多为程序层，非 prompt 层

- **prompt 层**（systemPrompt 指令模型生成）：omp、pi。
- **程序层**（CLI/UI 逻辑，不在 systemPrompt）：Claude Code、ChatGPT、opencode（标题生成是程序调用 LLM，不在主对话的 systemPrompt 里）。

pi 与 omp 是少数把命名放进扩展/prompt 层的；其余在程序层。程序层命名**天然规避了 transcript 收集残缺与 cursor 重放问题**——因为不依赖主对话的 branch/cursor。

---

## 4. 对 grilling 两个分歧的启示

### 岔路 A：toolCall 该不该进 transcript？

**证据指向：不该。**

- 所有可对照的 peer 都不把 toolCall 纳入标题输入（omp 显式移除；opencode 输入无 toolCall）。
- pi 当前"丢弃 toolCall"与 peer 一致，**不是缺陷**。
- 若纳入 toolCall，pi 将成为**唯一**这么做的 agent，且会显著增加 token 成本（assistant 消息中位数 text=0，绝大多数只有 toolCall）。

> 注：omp 的 replan **包含 thinking**（type:"thinking"）而 pi 不包含。若要小幅改进标题质量，**纳入 thinking 比 纳入 toolCall 更有依据**——omp 验证了 thinking 有用且不爆炸式增长 token。

### 岔路 B："整体弧线"目标是否现实？

**证据指向：不现实，且与 peer 取向相反。**

1. **没有 peer 要求"overall conversation arc"**。omp systemPrompt 明确"Treat the message only as text to title"（主题命名），replan 取**最近** 6 轮；opencode 用首条消息。pi 的"consider the overall conversation arc ... rather than focusing on the most recent messages"是**最雄心勃勃的**，也是**孤例**。
2. **内容层面就不成立**。transcript 丢弃了 toolCall（agent 的行动轨迹），LLM 看不到"读了什么/改了什么/跑了什么"，只能从 user 指令推测主题。在残缺视图上要求"弧线综合"是矛盾的——**没有行动轨迹，就没有弧线**。
3. **omp 的反例**：omp replan 刷新取**最近**窗口（最近 6 轮），取向是"跟踪主题漂移"而非"综合全弧线"。这与 pi "rather than focusing on the most recent" 直接冲突。

**两条可行路径**（供 grilling 决策，不预设结论）：

- **路径 B1（向 peer 靠拢）**：把 systemPrompt 目标从"整体弧线"降级为"基于（首条 + 最近窗口的）主题命名"。承认残缺视图只能给主题，不给弧线。这与 omp/opencode 一致，且让"丢弃 toolCall"变得自洽。
- **路径 B2（坚持弧线，补全输入）**：若真要弧线，必须让 LLM 看到行动轨迹——但 peer 没人这么做（成本/噪音），且 omp 的实证显示"只看 text+thinking 的最近窗口"已足够生成可用标题。这条路径缺乏 peer 支撑。

> **与 cursor bug 的关系**：岔路 B 的决策会反向影响岔路 A 与 cursor 修复方式。若选 B1（降级为主题命名），增量 transcript 的 cursor bug 影响减小（最近窗口对 cursor 精度不敏感）；若坚持全弧线增量，cursor 精度才关键。handoff 已确认 cursor bug 存在，但"修不修、怎么修"取决于先定岔路 B。

---

## 5. handoff 与关联调研

- **本调研的 handoff**：`/tmp/tmp.NWcEzbUEet-pi-handoff/handoff-session-naming-research.md`（含 grilling 完整来龙去脉、bug 证据链、已完成的 token 成本调研）
- **关联调研**：[auto-naming-transcript-cost.md](./auto-naming-transcript-cost.md)——全量 vs 增量 transcript 的 token 成本（1334 次 refresh 实测：全量均值 8,431 token vs 增量 3,004 token）
- **被审查插件**：`packages/auto-naming-session/extensions/index.ts`
- **pi 核心 API**：`~/github_code/pi/packages/coding-agent/src/core/session-manager.ts`、`agent-session.ts`

---

## 6. 调研方法与局限

| 对象 | 方法 | 局限 |
|---|---|---|
| omp | 本地源码逐文件精读（explorer 子代理） | 无 |
| opencode | GitHub 源码（`sst/opencode` dev 分支）+ issue tracker + 架构文章 | 标题生成的 LLM 调用函数未直接定位（应在 `prompt.ts` 64KB），输入内容依赖贡献者陈述；模型与时机已源码确认 |
| Claude Code | 本地泄露 prompt 全量搜索 + 配置 schema | 闭源，CLI 层命名逻辑不可见；输入/时机/模型均未知 |
| Cursor | 本地泄露 prompt 全量搜索 | 闭源，无任何证据 |
| ChatGPT | 本地泄露 prompt | 生成机制闭源，仅确认标题是注入变量 |
| pi 生态 | 本地仓库全量搜索 | 无（阴性结果可靠） |

> opencode 的"首条消息"输入目前由贡献者在 issue 中的陈述支撑（属于项目维护者描述自家系统，视为有效证据），并有"标题与 message summary 分离"的 issue 佐证。若需进一步提升证据强度，可 clone `sst/opencode` 仓库本地搜索 `prompt.ts` 中的标题生成函数。
