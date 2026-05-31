# 审查：plan 阶段

## 执行上下文 [执行]

- **变更目标**：新建 `@cnife/pi-auto-naming-session` 扩展，在会话 turn 结束时自动生成并刷新纯描述性会话标题
- **产物文件**：`plan.md`
- **基线文件**：`change.md`（v1 grill 结论）、`CONTEXT.md`（变更用语）、`CONTEXT.md`（根项目用语）
- **关键决策**：
  1. 纯描述标题，无标签
  2. lastEntryId 追踪消息范围
  3. 独立 JSON 配置文件
  4. 无 `/rename` 等交互式命令
  5. appendEntry 做手动标题保护
  6. 无重试/回退机制
- **验证的 API**：`pi.on("turn_end")`、`pi.on("session_start")`、`pi.appendEntry()`、`pi.setSessionName()`、`pi.getSessionName()` 均已通过源码确认存在
- **已确认的模型调用**：`ctx.modelRegistry.find()`、`ctx.modelRegistry.getApiKeyAndHeaders()` 签名已通过源码确认
- **未解决的问题**：`completeSimple` 的完整调用签名需在 coding 阶段确认

## 审查结论 [审查]

### 🔴 硬性阻塞

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 1 | plan.md 架构流程 + turn 计数实现 | **turn 计数边界条件与 grill 结论不一致**。Grill 结论 (#6) 约定 `auto_refresh_turns = 10` 时第 11、21…个 turn 触发刷新。但代码中 `turnCount > config.auto_refresh_turns + 1`（严格大于）导致第 11 个 turn **被跳过**，首次实际触发在 turn 21。应改为 `>=`。 | 将 `turnCount > config.auto_refresh_turns + 1` 改为 `turnCount >= config.auto_refresh_turns + 1` |
| 2 | plan.md LLM 调用细节 | **getApiKeyAndHeaders 返回类型未做 ok 检查**。`getApiKeyAndHeaders` 返回 `ResolvedRequestAuth = { ok: true; apiKey?; headers? } \| { ok: false; error: string }`。plan 中直接解构 `{ apiKey: auth.apiKey, headers: auth.headers }`，若 `auth.ok === false`（如缺少 API key），`auth.apiKey` 为 undefined，传给 `completeSimple` 会异常。 | 调用后检查 `if (!auth.ok) return;` 再解构 |
| 3 | plan.md 架构流程 | **缺少 try/catch 错误处理**。`completeSimple` 和 `getApiKeyAndHeaders` 均可抛出异步异常。plan 中"无重试/回退机制"是设计决定，但完全不加 try/catch 会导致事件处理器抛出未捕获异常，可能影响 pi 运行稳定性。 | 用 try/catch 包裹整个生成标题流程，异常时通知用户然后跳过 |
| 4 | plan.md 手动标题保护 | **未处理 `pi.getSessionName()` 返回 undefined 的情况**。当会话无标题时 `getSessionName()` 返回 `undefined`，`undefined !== latest.data.title` 恒为 true，导致手动标题保护误判为"用户手动修改过"，跳过标题生成。初次安装后恢复旧会话时，首轮生成会因此被跳过。 | 检查时应区分"从无标题"和"用户手动改过"：`currentName !== undefined && currentName !== latest.data.title` |

### 🟡 遗漏 / 歧义

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| 5 | plan.md 配置 | **配置文件缺失时的降级行为未定义**。"无 `enabled` 开关，删除文件/卸载扩展即禁用" —— 此处的"文件"含义模糊。若指配置文件 `cnife-pi-auto-naming-session.json`，则首次安装且无配置文件时应自动用默认值工作。需明确：配置文件是可选的（不存在则用默认值）还是必要的（不存在则禁用）。 | 检测到配置文件不存在时，创建带有默认值的配置文件 |
| 6 | plan.md LLM 调用细节 | **parseModelRef 未处理无 provider 前缀的 model ID**。当 `config.model = "gpt-4o"`（无 `/`）时，`parseModelRef` 返回 `provider = undefined`（因 `defaultProvider` 未传），继而 `ctx.modelRegistry.find(undefined, "gpt-4o")` 可能导致异常。 | 配置中的 model 必须带 provider 前缀（如 `anthropic/claude-sonnet-4`），否则解析错误，扩展应跳过初始化 |
| 7 | plan.md LLM 调用细节 | **ctx.model 可能为 undefined**。当 `config.model === null`（走当前模型）时，但 `ctx.model` 可能为 `undefined`（如刚启动未设模型），后续 `modelRegistry.getApiKeyAndHeaders(undefined)` 会出错。 | 在使用 `ctx.model` 前检查 `if (!ctx.model) return;` |
| 8 | plan.md 架构流程 + appendEntry 数据模型 | **timestamp 字段存在与否不一致**。架构流程步骤 8 中 appendEntry 数据包含 `timestamp`，但手动标题保护代码示例中省略了 `timestamp`。 | 统一数据模型，全量包含 `{ title, lastEntryId, timestamp }` 三个字段 |
| 9 | plan.md 消息上下文格式 | **plan 包含 tool 消息但应排除**。plan 的 `<session-transcript>` 示例包含 `[tool:bash]` 格式的消息。tool 消息对标题生成价值有限（通常是工具输出的噪声），用 user + assistant 消息已足够识别主题。 | 消息上下文只包含 user 和 assistant 消息，不含 tool 消息 |
| 10 | plan.md | **Event 回调签名：turn_end 回调是否接收 `(event, ctx)`？** 虽然 `pi.on("turn_end", handler)` 类型已确认，但 plan 未明确事件回调的签名和参数传递方式。 | 建议在代码中显式标注回调参数类型，如 `pi.on("turn_end", (event: TurnEndEvent, ctx: ExtensionContext) => { ... })` |

### 🟢 建议

| # | 位置 | 建议 |
|---|------|------|
| 11 | plan.md turn 计数实现 | `TurnEndEvent` 已含 `turnIndex` 字段，可直接复用而非维护内存 `turnCount` 变量。可简化：`event.turnIndex === 1` 判断首次生成，`event.turnIndex >= auto_refresh_turns + 1` 判断刷新。 |
| 12 | plan.md System Prompt | `max_length = 60` 硬编码。常见中文标题 15–30 字，60 字符绰绰有余。无需调整。 |
| 13 | plan.md 整体 | 方案结构清晰，API 调用与 pi 扩展类型定义一致。`completeSimple` 的入参格式（`timestamp` 字段在消息对象中）需在 coding 阶段通过 `@earendil-works/pi-ai` 的导出类型确认。 |

---

### 总评

方案整体设计合理，API 选择正确。**4 个 🔴 阻塞**问题需要在 coding 阶段前修复。其中 #1 是边界条件错误（`>` 应为 `>=`）影响首次刷新时机，#2 和 #3 是缺少防御性编程，#4 是 `undefined` 边界情况误判。确认 6 条反馈修正后即可进入 `plan-to-tasks` 阶段。
