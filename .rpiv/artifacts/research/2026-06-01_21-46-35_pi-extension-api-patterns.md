---
date: 2026-06-01T21:46:35+0800
author: CNife
commit: cb29b02
branch: auto-naming-session-plan
repository: pi-extensions
topic: "pi extension API 模式调研 — 为新建 @cnife/pi-auto-naming-session 扩展提供实现参考"
tags: [research, pi-extension, extension-api, auto-naming-session]
status: complete
last_updated: 2026-06-01T21:46:35+0800
last_updated_by: CNife
---

# Research: pi extension API 模式调研

## Research Question

调研仓库内已有 pi extension 的实现模式，包括扩展加载生命周期、事件注册与派发、Session API（setSessionName/getSessionName/appendEntry）、LLM 调用（modelRegistry / completeSimple）、配置文件管理、工具与命令注册等，为新建 `@cnife/pi-auto-naming-session` 扩展提供准确的实现参考。

## Summary

调研覆盖了 pi extension 的 6 个核心子系统，通过分析仓库内 4 个现有扩展（`cache-hit-rate`、`execute-python`、`simple-plannotator`、`miscs`）和 pi 核心运行时源码（loader.js / runner.js / session-manager.js / model-registry.js），得出以下关键结论：

1. **扩展加载**：工厂函数 `async` 安全 — `await factory(api)` 在 loader.js:266 执行，注册方法同步可用，但 action 方法（sendMessage/setSessionName）在 bindCore() 之前会抛异常。
2. **事件驱动**：`turn_end` 是 auto-naming 的触发点，它有 `turnIndex` 参数，首个 turn 为 0，适合首次生成。
3. **Session API**：`setSessionName()` 底层调 `appendSessionInfo()` 写 `SessionInfoEntry`；`getSessionName()` 反向扫描最近的非空 name；`appendEntry()` 写 `CustomEntry`，不参与 LLM 上下文。
4. **LLM 调用**：`completeSimple`（从 `@earendil-works/pi-ai` 导入）是正确选择，从不抛异常，需检查 `stopReason`。
5. **配置管理**：cache-hit-rate 的 init-once + 三级验证（文件I/O → 类型校验 → 语义校验）模式是标准做法。
6. **工具/命令**：auto-naming 无需交互式命令或工具，只注册事件即可。

## Detailed Findings

### 1. 扩展加载生命周期

#### 1.1 扩展发现与加载

`package.json` 的 `"pi": {"extensions": ["./extensions"]}` 字段 → `package-manager.js:1667-1698` 读取 `pi` 清单 → `resource-loader.js:271-274` 调用 `loadExtensions()` → `loader.js:320-344` 创建共享 `ExtensionRuntime`，对每个路径调用 `loadExtension()` → `loader.js:192-206` 用 jiti 编译模块 → 提取 `default export` 为工厂函数 → `loader.js:266` 执行 `await factory(api)`。

#### 1.2 ExtensionAPI 对象

`createExtensionAPI()` 在 `loader.js:98-191` 构建 `pi.*` 方法：

- **`pi.on(event, handler)`** (loader.js:104-108)：写入 `extension.handlers.get(event)` 数组
- **`pi.registerTool(tool)`** (loader.js:109-116)：写入 `extension.tools` Map
- **`pi.registerCommand(name, options)`** (loader.js:117-124)：写入 `extension.commands` Map
- **action 方法转发** (loader.js:142-190)：所有方法委托到 `runtime[name]`，在 bindCore() 前是 throwing stubs
- **`pi.events`** (loader.js:189)：共享的 `EventBus` 实例，工厂函数内立即可用

#### 1.3 BindCore 时机

`ExtensionRunner.bindCore()` 在 `runner.js:103-155` 执行：

- 替换 runtime 的 throwing stubs 为真实实现（setSessionName → AgentSession.setSessionName）
- flush pending provider registrations (runner.js:126-141)
- 此后 `pi.setSessionName()` 等 action 方法才可用

#### 1.4 完整生命周期时间线

1. `loadExtensions()` 创建 shared runtime + throwing stubs (loader.js:328)
2. 对每个路径：jiti 编译 → 提取 factory → `createExtensionAPI(api)` → `await factory(api)` (loader.js:330-342)
3. `AgentSession._buildRuntime()` 创建 ExtensionRunner (agent-session.js:1891)
4. `_bindExtensionCore(runner)` 调用 `runner.bindCore()` 替换 stubs (agent-session.js:1895)
5. `bindExtensions()` 发出 `session_start` 事件 (agent-session.js:1626-1628)

**关键结论**：工厂函数内只能做 `pi.on()` 注册事件，`pi.setSessionName()` 在 bindCore() 前不可用。但事件处理器在 bindCore() 之后才被调用，所以处理器内部使用全都没有问题。

### 2. 事件注册与派发

#### 2.1 事件存储

`loader.js:104-108` 将 handler 存入 `extension.handlers` Map。ExtensionRunner 持有所有 extension 实例（`runner.js:79` 构造函数中设置）。

#### 2.2 Event Emit 派发

`ExtensionRunner.emit()` 在 `runner.js:282-310`：

```javascript
async emit(event) {
    const ctx = this.createContext();       // 每次 emit 创建新 context
    for (const ext of this.extensions) {
        const handlers = ext.handlers.get(event.type);
        if (!handlers) continue;
        for (const handler of handlers) {
            try {
                await handler(event, ctx);
            } catch (err) {
                this.emitError({ extensionPath: ext.path, event: event.type, ... });
            }
        }
    }
}
```

- 每个 handler 有独立 try/catch，失败不影响其他 handler
- `session_start` 没有 return value，不阻塞

#### 2.3 createContext() — 惰性属性

`runner.js:241-279` 返回 getter 对象，所有属性在访问时动态解析：

| 属性 | 可用性 | 说明 |
|------|--------|------|
| `ui` | ✅ 如已调用 setUIContext() | print/RPC 模式为 noOpUIContext |
| `sessionManager` | ✅ | Readonly，可调用 `getSessionName()` |
| `modelRegistry` | ✅ | 用于 API key / model 发现 |
| `model` | ✅ | 当前 model，可能 undefined |
| `isIdle()` | ✅ | `!isStreaming` |
| `signal` | ✅/❌ | 仅 streaming 时有值 |
| `shutdown()` | ✅ | 触发 AgentSession 关闭 |
| `getSystemPrompt()` | ✅ | 返回当前 system prompt |

#### 2.4 session_start 事件

`types.d.ts:519-528`：

```typescript
interface SessionStartEvent {
    type: "session_start";
    reason: "startup" | "reload" | "new" | "resume" | "fork";
    previousSessionFile?: string;
}
```

发出时机：

- `bindExtensions()` (agent-session.js:1628) — `reason: "startup"`
- `reload()` (agent-session.js:1923) — `reason: "reload"`
- `newSession()` (agent-session-runtime.js:148) — `reason: "new"`
- `switchSession()` (agent-session-runtime.js:122) — `reason: "resume"`
- `fork()` (agent-session-runtime.js:190) — `reason: "fork"`

#### 2.5 turn_end 事件（auto-naming 的触发点）

`types.d.ts:607-612`：

```typescript
interface TurnEndEvent {
    type: "turn_end";
    turnIndex: number;
    message: AgentMessage;
    toolResults: ToolResultMessage[];
}
```

发出时机：`agent-session.js:380-387`，每次 agent 完成一个完整 turn 后：

```javascript
if (event.type === "turn_end") {
    this._turnIndex++;    // turnIndex 从 0 开始递增
}
```

**对 auto-naming 的价值**：

- `turnIndex === 0`：首个 turn 结束 → 触发首次命名
- `turnIndex % N === 0`：每 N 个 turn → 触发自动刷新
- 可访问 `event.message` 获取对话内容
- 此时 `ctx.sessionManager` 和 `pi.setSessionName()` 完全可用

#### 2.6 其他相关事件

| 事件 | types.d.ts 行号 | 对 auto-naming 的价值 |
|------|----------------|----------------------|
| `session_tree` | 580-588 | navigate/undo 后需重算名称 |
| `session_compact` | 555-559 | 压缩后可能需重新评估名称 |
| `before_agent_start` | 580-590 | 可注入 systemPrompt，但 auto-naming 不需要 |
| `input` | 626-636 | 可拦截用户输入，但 auto-naming 用 `turn_end` 更合适 |

### 3. Session API

#### 3.1 pi.setSessionName(name)

调用链：
`ExtensionAPI.setSessionName()` → `loader.js` 转发到 runtime → `AgentSession.setSessionName()` (agent-session.js:2106-2109) → `SessionManager.appendSessionInfo(name)` (session-manager.js:683-692)

`appendSessionInfo()` 创建一个 `SessionInfoEntry`（session-manager.d.ts:93-97）：

```typescript
interface SessionInfoEntry extends SessionEntryBase {
    type: "session_info";
    name?: string;
}
```

- `parentId` 设为当前 leaf (`this.leafId`)
- name 在存储前 `.trim()`
- 同时发出 `session_info_changed` 内部事件（用于 UI 更新）

**注意**：多次调用 `setSessionName()` 会创建多个 `SessionInfoEntry`，但 `getSessionName()` 只返回最近的非空 name。

#### 3.2 pi.getSessionName()

`SessionManager.getSessionName()` (session-manager.js:695-703)：

```javascript
getSessionName() {
    const entries = this.getEntries();
    for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].type === "session_info") {
            return entries[i].name?.trim() || undefined;
        }
    }
    return undefined;
}
```

- 反向遍历所有 entries
- 返回最新 `session_info` 的 name
- 未设置时返回 `undefined`

#### 3.3 pi.appendEntry(customType, data)

调用链：
`ExtensionAPI.appendEntry()` → `SessionManager.appendCustomEntry()` (session-manager.js:669-677)

创建 `CustomEntry`（session-manager.d.ts:47-65）：

```typescript
interface CustomEntry<T = unknown> extends SessionEntryBase {
    type: "custom";
    customType: string;
    data?: T;
}
```

**关键特性**：

- 持久化在 session JSONL 中，跨 session reload 可恢复
- **不参与 LLM 上下文** — `buildSessionContext()` 完全忽略 `"custom"` 类型
- 返回 `entry.id`，可用于后续追踪

**对比 CustomMessageEntry**（session-manager.d.ts:98-110）：

- `type: "custom_message"` 参与 LLM 上下文
- 用于注入 LLM 可见的信息
- auto-naming 不需要这个

#### 3.4 session 树遍历：getBranch()

`SessionManager.getBranch()` (session-manager.js:792-801)：

```javascript
getBranch(fromId) {
    const path = [];
    const startId = fromId ?? this.leafId;
    let current = startId ? this.byId.get(startId) : undefined;
    while (current) {
        path.unshift(current);
        current = current.parentId ? this.byId.get(current.parentId) : undefined;
    }
    return path;  // root → leaf 顺序
}
```

返回从根到当前 leaf 的所有 `SessionEntry` 对象（含所有类型：message、custom、model_change、compaction、session_info 等）。

#### 3.5 buildSessionContext() — 提取 LLM 可见消息

`session-manager.js:113-200` 展示了规范的遍历方法，只保留三种类型：

- `"message"` — 普通对话
- `"custom_message"` — 自定义消息（LLM 可见）
- `"branch_summary"` — 分支摘要

`compaction` 条目触发消息替换为摘要。这对 auto-naming 从 getBranch() 提取最近对话上下文命名时很重要——需要用 `buildSessionContext` 的逻辑过滤出 LLM 实际看到的消息。

### 4. LLM 调用

#### 4.1 modelRegistry 访问

`ctx.modelRegistry` 通过 `runner.createContext()` 注入（runner.js:397），是 `ModelRegistry` 实例。

#### 4.2 modelRegistry.find()

`model-registry.d.ts:75-77` / `model-registry.js:364-366`：

```javascript
find(provider, modelId) {
    return this.models.find(m => m.provider === provider && m.id === modelId);
}
```

返回 `Model<Api>` 或 `undefined`。需要先检查返回是否为 undefined。

#### 4.3 modelRegistry.getApiKeyAndHeaders()

`model-registry.d.ts:85-87` / `model-registry.js:387-425`：

```javascript
// 返回类型
type ResolvedRequestAuth = 
  | { ok: true; apiKey?: string; headers?: Record<string, string> }
  | { ok: false; error: string };
```

实现流程：

1. 获取 providerConfig（从 models.json）
2. `authStorage.getApiKey(model.provider)` — 从环境变量/OAuth/command 解析
3. 合并 headers：`model.headers → providerHeaders → modelHeaders`
4. 如 `authHeader` 已设置，注入 `Authorization: Bearer ${apiKey}`
5. 成功后返回 `{ ok: true, apiKey, headers }`，失败返回 `{ ok: false, error: "..." }`

**必须检查 `auth.ok`**，失败时不能使用。

#### 4.4 completeSimple — 推荐方案

**导入路径**：`@earendil-works/pi-ai`

**签名**（stream.d.ts:7）：

```typescript
function completeSimple<TApi extends Api>(
    model: Model<TApi>,
    context: Context,           // { systemPrompt?, messages, tools? }
    options?: SimpleStreamOptions  // { apiKey?, headers?, maxTokens?, signal?, reasoning? }
): Promise<AssistantMessage>;
```

**Context 类型**：

```typescript
interface Context {
    systemPrompt?: string;
    messages: Message[];         // { role, content }[]
    tools?: Tool[];
}
```

**SimpleStreamOptions** 含 `apiKey`、`headers`、`maxTokens`、`signal`（AbortSignal）、`reasoning` 等。

**AssistantMessage 返回**：

```typescript
interface AssistantMessage {
    role: "assistant";
    content: (TextContent | ThinkingContent | ToolCall)[];
    usage: Usage;
    stopReason: StopReason;      // "stop" | "length" | "toolUse" | "error" | "aborted"
    errorMessage?: string;
    // ...
}
```

**关键行为**：`completeSimple` **从不抛异常**。必须在返回后检查 `stopReason`：

```typescript
if (result.stopReason === "error" || result.stopReason === "aborted") {
    // result.errorMessage 包含详情
    return;  // 跳过命名
}
```

#### 4.5 sendUserMessage — 不推荐

`pi.sendUserMessage(content, options?)`（types.d.ts:841-843）走完整 agent loop，可能触发 tool 调用，对 session 产生副作用。auto-naming 不需要这个。

### 5. 配置文件管理

#### 5.1 标准模式：cache-hit-rate 的 init-once

**配置路径**（cache-hit-rate.ts:17）：

```typescript
const CONFIG_PATH = join(getAgentDir(), "cnife-cache-hit-rate.json");
```

`getAgentDir()` 在 `config.js:385-391` 实现，返回 `~/.pi/agent/`（除非设置了 `PI_CODING_AGENT_DIR` 环境变量）。

**配置加载**（cache-hit-rate.ts:65-105）：

1. 文件不存在 → 写入 `DEFAULT_CONFIG`（含目录递归创建）
2. 读取文件 → JSON.parse
3. 类型校验（手动 duck-typing）
4. 语义校验（validateColorRules）
5. 返回校验后的 config 对象；失败返回 `null`

**init 时机**（cache-hit-rate.ts:331-390）：

- `loadConfig()` 在工厂函数顶部调用一次（line 332）
- 结果 destructure 到闭包（line 344）
- 所有事件处理器都闭包引用这些值
- config 为 `null` 时注册 error display handler 后 return

#### 5.2 对 auto-naming 的启示

| 要素 | cache-hit-rate | auto-naming 应 |
|------|---------------|----------------|
| 配置路径 | `getAgentDir() + "cnife-cache-hit-rate.json"` | `getAgentDir() + "cnife-auto-naming-session.json"` |
| 导入 | `@earendil-works/pi-coding-agent` | 相同导入 |
| 加载时机 | 工厂函数顶部，一次 | 相同模式 |
| 校验 | 三级：I/O → 类型 → 语义 | 自定义校验 |
| 错误处理 | null → 显示 error | null → 用默认值继续 |

### 6. 工具与命令注册（auto-naming 不需要，仅记录参考）

#### 6.1 工具注册

`defineTool()` (types.d.ts:468-477) → `pi.registerTool(tool)` (execute-python.ts:441) → `wrapRegisteredTool()` (wrapper.js:10-18) → 注入 `ctx` 到 `execute()` 的第 5 参数。

#### 6.2 命令注册

`pi.registerCommand(name, options)` (types.d.ts:722-725) → handler 接收 `(args, ctx: ExtensionCommandContext)`。`ExtensionCommandContext` 额外提供 `waitForIdle()`、`newSession()`、`fork()`、`navigateTree()`、`switchSession()`、`reload()`。

auto-naming 不需要注册工具或命令，只注册事件即可。

## Code References

- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js:98-191` — createExtensionAPI: pi.on/registerTool/registerCommand 实现
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js:266` — await factory(api) 调用点
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:103-155` — bindCore() 替换 stubs
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:282-310` — emit() 通用派发
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:241-279` — createContext() 惰性属性
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:375-405` — emitInput() 链式派发
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:683-692` — appendSessionInfo()
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:695-703` — getSessionName()
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:669-677` — appendCustomEntry()
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:792-801` — getBranch() 树遍历
- `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js:113-200` — buildSessionContext() LLM 可见消息提取
- `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.js:364-366` — find()
- `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.js:387-425` — getApiKeyAndHeaders()
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:380-387` — turn_end 事件发出
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:2106-2109` — setSessionName 实现
- `node_modules/@earendil-works/pi-coding-agent/dist/config.js:385-391` — getAgentDir()
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:17-105` — 配置管理完整模式
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:115-152` — buildState() → getBranch() 遍历模式
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:230-268` — 事件驱动状态管理
- `packages/miscs/extensions/exit.ts:3-10` — input 事件拦截示例
- `packages/execute-python/extensions/execute-python.ts:40-441` — defineTool + registerTool 示例
- `packages/simple-plannotator/extensions/index.ts:160` — registerCommand 示例
- `node_modules/@earendil-works/pi-ai/dist/stream.d.ts:7` — completeSimple 类型签名
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:213-226` — AssistantMessage 类型
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:245-249` — Context 类型
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/summarize.ts:188` — completeSimple 官方示例

## Integration Points

### Inbound References

- 无 — auto-naming-session 是新建独立扩展，不引用其他扩展

### Outbound Dependencies

- `@earendil-works/pi-coding-agent` — `getAgentDir()` 用于配置路径
- `@earendil-works/pi-ai` — `completeSimple` 用于 LLM 调用

### Infrastructure Wiring

- 无 — 纯事件驱动，不涉及路由/DI/中间件

## Architecture Insights

### 核心架构模式

1. **事件驱动，无状态**：pi extension 围绕事件注册展开，`pi.on()` 注册 → `runner.emit()` 派发。不需要轮询或定时器。

2. **工厂闭包**：配置和状态在工厂函数顶部初始化（一次），通过闭包注入事件处理器。不要在每个事件中重新加载配置。

3. **惰性 Context**：`createContext()` 返回 getter 对象，所有属性访问动态解析。不能保存 `ctx` 引用跨多个异步调用使用，应在每个处理器内即时访问。

4. **错误隔离**：`emit()` 内每个 handler 有独立 try/catch，失败不影响其他 handler 和扩展。

### auto-naming 架构原则

- 只注册事件（`turn_end`、`session_start`），不注册工具/命令
- 配置在工厂函数顶部加载一次
- LLM 调用用 `completeSimple`（fire-and-forget），不走 agent loop
- 用 `appendEntry` 持久化命名元数据（title, lastEntryId, timestamp）
- 异常不抛出，用 try/catch 包裹后 `ctx.ui.notify` + 跳过

## Precedents & Lessons

0 similar past changes analyzed — 仓库内尚无扩展使用 setSessionName / completeSimple。

## Historical Context (from `.rpiv/artifacts/`)

- `changes/20260531-auto-naming-session/change.md` — 本次变更的原始 grill 结论和 plan 审查
- `changes/20260531-auto-naming-session/plan.md` — 本次变更的原始实施计划
- `changes/20260531-auto-naming-session/CONTEXT.md` — 变更用语定义

## Developer Context

**Q (`loader.js:266`): 工厂函数内 await 是否安全？pi.on() 注册是否必须在同步阶段完成？**
A: 安全。`await factory(api)` 在 loader.js:266 执行，工厂函数内可做 `pi.on()/registerTool()/registerCommand()` 和任意异步初始化。action 方法在 bindCore() 前是 throwing stubs，但注册方法（on/registerTool/registerCommand）同步可用。

**Q (`runner.js:103-155`): 事件处理器调用时 bindCore() 已完成了吗？pi.setSessionName() 在事件处理器内可用吗？**
A: 是的。扩展工厂函数在 loader.js 中执行（此时只有 stubs），但事件处理器只在 bindExtensions() 之后触发，此时 bindCore() 已完成。所以事件处理器内 `pi.setSessionName()` / `ctx.sessionManager.getSessionName()` 完全可用。

**Q (`completeSimple` 调用模式): 需要传完整的 Context 对象吗？**
A: 只需 `{ messages: [...] }`。Context 的 systemPrompt 和 tools 字段都是 optional，auto-naming 不需要。

## Open Questions

无 — 所有问题已在 developer checkpoint 中解决。

## Next Step

调研文档已就绪，包含实现 auto-naming-session 所需的所有 API 细节。

**推荐下一步**：

- `/skill:blueprint .rpiv/artifacts/research/2026-06-01_21-46-35_pi-extension-api-patterns.md` — 基于调研产出直接生成实施计划
