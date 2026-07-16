# R2 调研：nowledge-mem-pi extension 的 sync + 注入实现

> wayfinder ticket #62 的 research findings。为 ticket D（ambient sync fork 改造点）提供基线。
> 调研日期：2026-07-15

## 源码位置

- **主扩展文件**: `~/.pi/agent/npm/node_modules/nowledge-mem-pi/extensions/nowledge-mem.ts`
  - 单文件实现，~550 行 TypeScript
  - 通过 `package.json` 的 `pi.extensions` 字段注册
  - 导出默认函数 `nowledgeMemPi(pi: ExtensionAPI)`
- **历史批量同步 CLI**: `~/.pi/agent/npm/node_modules/nowledge-mem-pi/scripts/sync-history.mjs`
  - 独立 Node.js CLI（bin: `nowledge-mem-pi-sync`），回填旧会话
  - 逻辑与扩展类似但另写一份（有重复），fork 时只关注扩展
- **Skills**: `~/.pi/agent/npm/node_modules/nowledge-mem-pi/skills/` 下 5 个子目录（read-working-memory, search-memory, distill-memory, save-thread, status）

## 1. Ambient Sync（自动同步）

### 1.1 挂载的 Pi 事件

扩展通过 `pi.on()` 注册 5 个事件：

| 事件 | 回调 | 作用 |
|------|------|------|
| `agent_end` | `scheduleFlush(ctx, "agent_end")` | 每次 agent 回复完成后调度的同步（防抖） |
| `session_before_compact` | `await flush(ctx, "session_before_compact")` | 压缩前立即同步（确保数据不丢） |
| `session_before_switch` | `await flush(ctx, event.reason === "new" ? "session_new" : "session_resume")` | 切会话前立即同步，同时 evict 旧会话的启动上下文缓存 |
| `session_shutdown` | `await flush(ctx, "session_shutdown:${event.reason}")` | 关闭会话时立即同步，evict 缓存 |

**关键要点**:
- `turn_end`、`message_end` **没有**单独挂--高频同步只在 `agent_end` 用防抖，低频/刚性同步在 `session_before_compact`/`switch`/`shutdown` 做 **flush()**（立即发）。
- `session_start` 事件被占用用于刷新启动上下文缓存（见后文）。

### 1.2 防抖调度 (`scheduleFlush` -> `flushPayload`)

**代码位置**: `nowledge-mem.ts:210-225`

```ts
const FLUSH_DELAY_MS = 750; // 行 18

function scheduleFlush(ctx: ExtensionContext, reason: string): void {
  const payload = buildSyncPayload(ctx, reason);
  if (!payload) return;
  const key = payload.threadId;
  const state = syncStates.get(key) || {};
  syncStates.set(key, state);
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = undefined;
    void flushPayload(payload);
  }, FLUSH_DELAY_MS);
}
```

- 每次 `agent_end` 触发**重置** 750ms 定时器
- **只保留最新 payload**：调度时重新 `buildSyncPayload()`，timer 触发时的 payload 是当时的最新快照

### 1.3 同步流程 (`flushPayload` -> `flushOnce` -> `postJson`)

**`flushPayload`** (行 190-208): 带 `pending`/`inFlight` 串行控制：

```ts
async function flushPayload(payload: SyncPayload): Promise<void> {
  const state = syncStates.get(key) || {};
  if (state.inFlight) {
    state.pending = true;   // 有在飞的请求，标记 pending
    await state.inFlight;   // 等它完成
    return;                 // 返回后调用者会走 do..while 重试
  }
  do {
    state.pending = false;
    state.inFlight = flushOnce(payload, state).finally(() => { state.inFlight = undefined; });
    await state.inFlight;
  } while (state.pending);  // 如果有新 pending，重新 flush
}
```

**`flushOnce`** (行 169-188): 两阶段策略：

1. **首次 = POST /threads**（创建线程）
2. **后续 = POST /threads/{threadId}/append**（追加消息，带 `deduplicate: true` + `idempotency_key`）
   - 如果 append 返回 404（thread not found），重置 `state.created = false`，再次 POST /threads 创建

### 1.4 REST 调用 (`postJson`)

**代码位置**: `nowledge-mem.ts:101-140`

```ts
async function postJson(path: string, body: JsonObject): Promise<{ ok, status, data }>
```

- URL 从配置解析（见 1.7）
- 请求头: `Content-Type: application/json` + 可选 `Authorization: Bearer <key>` + `X-NMEM-API-Key`
- 超时: `API_TIMEOUT_MS = 8_000`（8 秒）
- 自动注入 `space_id` 到 body
- 带 URL fallback（处理 `/remote-api` -> `/` 路径重写）

### 1.5 消息构建 (`buildMessages` / `entryToMessage`)

**代码位置**: `nowledge-mem.ts:160-198`（生成） + `nowledge-mem.ts:62-157`（转换）

核心逻辑：

1. 通过 `ctx.sessionManager.getBranch()` 获取当前分支的 entries
2. 每条 entry 按类型转换：
   - **message**：根据 role 转 `user`/`assistant`，role = `custom` 则**跳过**（排除扩展注入的上下文）
   - **custom_message**：转成 `user` 角色，标签注明 custom type
   - **compaction / branch_summary**：转成 `assistant` 角色
   - `bashExecution` -> `user` 角色，格式化为代码块
3. 每条消息添加 metadata：`external_id`、`pi_entry_id`、`pi_entry_type`、`pi_message_role` 等
4. **内容截断**：`MAX_MESSAGE_CHARS = 20_000`

**筛选条件**: `shouldSync` (行 158) - 必须有至少一条 user 消息 AND 至少一条 assistant 消息才同步。

### 1.6 降级处理

- **后端不可达**：`postJson` 在 fetch 失败（网络错误/超时）时，遍历所有 URL fallback 仍失败则返回 `{ ok: false, status: 0, data: { error: ... } }`
- **flush 失败**：`flushOnce` 记录 `state.lastError` 并通过 `console.warn` 输出，**不重试**（由下一次 `agent_end` 或更刚性的事件触发新的 flush）
- **空间配置**：如果配置了 `space`，所有 REST 调用自动注入 `space_id`。fork 时可沿用。

### 1.7 配置解析

**代码位置**: `nowledge-mem.ts:44-66`

优先级链：环境变量 > 共享配置 `~/.nowledge-mem/config.json` > 默认值

| 配置项 | 环境变量 | config.json 字段 | 默认值 |
|--------|----------|-----------------|--------|
| API URL | `NMEM_API_URL` | `apiUrl` / `api_url` | `http://127.0.0.1:14242` |
| API Key | `NMEM_API_KEY` | `apiKey` / `api_key` | 无 |
| Space | `NMEM_SPACE` / `NMEM_SPACE_ID` | `space` / `spaceId` / `space_id` | 无 |
| Agent ID | `NMEM_AGENT_ID` | `agentId` / `agent_id` | 无 |
| Host Agent ID | `NMEM_HOST_AGENT_ID` | `hostAgentId` / `host_agent_id` | 无 |

## 2. 启动上下文注入

### 2.1 挂载的事件

```ts
pi.on("session_start", async (_event, ctx) => {
  await refreshStartupContext(ctx);           // 仅刷新缓存
});

pi.on("before_agent_start", async (event, ctx) => {
  return { systemPrompt: await appendMemoryContext(event.systemPrompt, ctx) };  // 实际注入
});
```

- `session_start`：**异步**刷新 Context Bundle 缓存，不阻塞启动
- `before_agent_start`：**修改 systemPrompt**，追加 Context Bundle + Guidance 文本。这是注入点

### 2.2 上下文读取策略 (`readStartupContext`)

**代码位置**: `nowledge-mem.ts:286-314`

按**优先级降序**依次尝试 4 种途径（最多 4 次 `nmem` CLI 调用）：

| 顺序 | 途径 | CLI 命令 | 解析函数 |
|------|------|---------|---------|
| 1 | Context Bundle（带 space） | `nmem --json context --source-app pi --space <space> --agent-id ... --host-agent-id ...` | `parseContextBundleMarkdown` 取 `rendered_markdown` |
| 2 | Context Bundle（不带 space fallback） | 同上，但 `space` 设为 undefined | 同上 |
| 3 | Working Memory（带 space） | `nmem --json wm read --space <space>` | `parseWorkingMemoryMarkdown` 取 `content`，检查 `exists` |
| 4 | Working Memory（不带 space fallback） | 同上，但 `space` 设为 undefined | 同上 |

**全部失败后的本地 fallback**（行 306-308）：
- 条件：配置为默认本地 API URL（`http://127.0.0.1:14242`）且无 space/agent 定制
- 读取 `~/.ai-now/memory.md` 文件内容

**超时控制**：`deadline = Date.now() + API_TIMEOUT_MS`（8s），4 次尝试共享此 deadline。超时后标记 `timedOut`。

### 2.3 注入文本格式 (`appendMemoryContext`)

**代码位置**: `nowledge-mem.ts:328-337`

```ts
async function appendMemoryContext(systemPrompt: string, ctx: ExtensionContext): Promise<string> {
  const sections: string[] = [];
  if (entry?.context) {
    sections.push(`## Nowledge Mem Context Bundle\n\n${entry.context}`);
  } else if (entry?.degradedReason) {
    sections.push(`## Nowledge Mem Context Bundle\n\n[Nowledge Mem startup context unavailable: ${entry.degradedReason}.]`);
  }
  sections.push(startupGuidance());
  return `${systemPrompt}\n\n${sections.join("\n\n")}`;
}
```

即在 systemPrompt 末尾 append 两节：
1. **## Nowledge Mem Context Bundle** - Context Bundle 的 rendered_markdown 或降级说明
2. **## Nowledge Mem Guidance** - 固定文本提示，告诉 LLM 何时使用 nmem 技能

**`startupGuidance()`**（行 36-51）生成约 15 行引导文本，包含：
- Context Bundle 已注入，不要重复读
- 何时 search memory / search threads / save memory
- 何时 create handoff thread
- 设置 `source_app`

### 2.4 缓存机制

- `startupContextCache: Map<string, StartupContextEntry>` - 按 session ID 缓存读取结果
- `refreshStartupContext(ctx)` - 填充缓存
- `evictStartupContext(ctx)` - 切会话/关会话时清理
- 寿命：一次 session_start -> session_shutdown

### 2.5 降级处理

- **CLI 不存在或超时**：记录 `console.warn`，返回 `{ degradedReason: "startup context reads timed out" }` 或 `"startup context reads failed"`
- **最终 fallback**：仍会注入 **Guidance 文本**（不带 Context Bundle），保证 LLM 至少知道如何使用 nmem 技能
- 降级信息会注入到 systemPrompt 让 LLM 知晓

## 3. fork 改造基线判断

### 可直接复用的设计

| 设计点 | 理由 |
|--------|------|
| 事件挂载模式（`session_start` + `before_agent_start` + `agent_end` + 刚性事件 flush） | 通用 pi extension 模式 |
| 两阶段 thread sync（POST /threads -> POST /threads/{id}/append） | 后端无变更则无需改 |
| `deduplicate: true` + `idempotency_key` | 保证幂等 |
| 防抖 + pending/inFlight 串行控制 | 可靠且简洁 |
| `entryToMessage` 的 role normalize 逻辑 | pi session 格式稳定 |
| 启动上下文缓存 + evict 生命周期 | 干净 |

### 需要改造的部分

| 改造点 | 原因 |
|--------|------|
| **REST 调用改为 pi-native custom tool** | pi-nmem ADR-0001 核心动机：去掉 `nmem` CLI 中介层，改为 `pi.registerTool()` |
| `readStartupContext` 中的 CLI spawn | 当前走 `execFile("nmem", ...)`，fork 后应改为 REST API 直接获取 Context Bundle / Working Memory |
| 配置文件路径 | 当前硬编码 `~/.nowledge-mem/config.json`，pi-nmem 应考虑自己的配置路径或环境变量 |
| space 注入方式 | 当前走 CLI args + REST body 两次注入，fork 后统一走 REST body |
| `startupGuidance()` 中的固定指引文本 | pi-nmem 的 product name / host label 应改为 `pi-nmem` 或 `CNife's Pi` |
| source_app 标签 | 当前硬编码 `pi`，pi-nmem 应改为自定义 source 标识 |
| 所有 `console.warn` 降级日志 | 可考虑 pi extension 的 logger API 替代 |
| 本地 WM fallback 路径 | `~/.ai-now/memory.md` 是 nowledge-mem 桌面版路径，pi-nmem 应删除或替换 |

### 分界线清晰的模块

- **消息转换** (`entryToMessage`, `messageToText`, `partToText`, `truncate`) - 可无改复用
- **两阶段 sync 逻辑** (`flushOnce`, `flushPayload`) - 接口改成 pi-native 即可
- **启动上下文读取策略**（4 级尝试 + 降级）- 可保留，但实现改为 REST 调用而非 CLI spawn
- **缓存管理层** (`startupContextCache`, `refreshStartupContext`, `evictStartupContext`) - 可无改复用
