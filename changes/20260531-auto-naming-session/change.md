# 变更 v1：grill 细化

> 使用 grill 对照 CONTEXT.md 逐条追问，澄清 plan.md 中的模糊表述。

## 澄清结论

| # | 问题 | 结论 |
|---|------|------|
| 1 | 去留范围 | 完全新建插件 `@cnife/pi-auto-naming-session`，不继承 `@furbyhaxx/pi-session-naming` 的 `/rename`、`/sessions`、`--list-sessions`、标签系统、项目元数据、临时标题重试等 |
| 2 | 包结构 | 放在 `packages/auto-naming-session/`，npm 包名 `@cnife/pi-auto-naming-session` |
| 3 | 标题格式 | 纯描述性标题，无 Conventional Commit 标签 |
| 4 | 标题语言 | 通过配置项 `language` 控制，默认 `"english"` |
| 5 | 首次触发 | 所有会话的首个 turn 结束时触发（含恢复旧会话） |
| 6 | 自动刷新 | `auto_refresh_turns` 按总 turn 数计数，默认 10 → 第 11、21…个 turn 触发；`null` 禁用 |
| 7 | 手动标题保护 | 用 `pi.appendEntry("auto-naming-title", { title, lastEntryId })` 记录，对比 `pi.getSessionName()` 判断是否手动修改，不一致则不覆盖 |
| 8 | 上次刷新位置追踪 | 记录 `lastEntryId`，下次只取该 ID 之后的消息作为 LLM 上下文；找不到 `lastEntryId`（如 compact）则发全部 |
| 9 | 配置项 | `auto_refresh_turns: number \| null`（默认 10）、`model: str \| null`（默认 `null` 走当前模型）、`language: str`（默认 `"english"`），无 `enabled` 开关 |
| 10 | 配置文件 | `$PI_CODING_AGENT_DIR/cnife-pi-auto-naming-session.json` |
| 11 | 调研：LLM 调用 | 从 `@earendil-works/pi-ai` 导入 `completeSimple`，用 `ctx.modelRegistry.find()` + `getApiKeyAndHeaders()` 获取模型和认证 |
| 12 | 调研：提示词 | 纯描述性标题 system prompt，`<session-transcript>` 传上下文，无标签/元数据 |

---

## 变更 v2：plan 方案

> 方案已写入 plan.md。

### 方案摘要

- **单入口**：`extensions/index.ts`，注册 `turn_end` 和 `session_start` 事件
- **首次生成**：turnCount === 1 时触发
- **自动刷新**：`turnCount > auto_refresh_turns + 1` 且 `(turnCount - 1) % auto_refresh_turns === 0` 时触发
- **消息范围**：`lastEntryId` 之后的消息（含 user/assistant/toolResult）
- **手动保护**：`pi.appendEntry` 记录 `{ title, lastEntryId }`，比对 `getSessionName()`
- **LLM 调用**：`completeSimple` + `modelRegistry.find()` + `getApiKeyAndHeaders()`
- **提示词**：纯描述 system prompt，`<session-transcript>` 传上下文
- **turn 计数**：内存变量 `turnCount`，`session_start` 重置为 0

---

## 变更 v3：plan 阶段审查 [审查]

### 发现

| # | 分级 | 位置 | 问题 | 建议 |
|---|------|------|------|------|
| 1 | 🔴 | turn 计数实现 | turn 计数边界条件与 grill 结论不一致。Grill 约定第 11 个 turn 触发，但 `>` 导致跳过。 | `>` 改为 `>=` |
| 2 | 🔴 | LLM 调用细节 | getApiKeyAndHeaders 返回类型未做 ok 检查，auth 失败时异常。 | 调用后检查 `if (!auth.ok) return;` |
| 3 | 🔴 | 架构流程 | 缺少 try/catch 错误处理，completeSimple 异常可能影响 pi 稳定性。 | 用 try/catch 包裹整个生成流程，异常时通知用户然后跳过 |
| 4 | 🔴 | 手动标题保护 | getSessionName() 返回 undefined 时误判为用户手动修改。 | 加 `currentName !== undefined` 判断 |
| 5 | 🟡 | 配置 | 配置文件缺失时的降级行为未定义。 | 不存在时创建带有默认值的配置文件 |
| 6 | 🟡 | LLM 调用细节 | parseModelRef 未处理无 provider 前缀的 model ID。 | 配置的 model 必须带 provider 前缀，否则解析错误，跳过初始化 |
| 7 | 🟡 | LLM 调用细节 | ctx.model 可能为 undefined 时未防护。 | 使用前检查 `if (!ctx.model) return;` |
| 8 | 🟡 | appendEntry 数据模型 | timestamp 字段存在与否不一致。 | 全量包含 `{ title, lastEntryId, timestamp }` |
| 9 | 🟡 | 消息上下文格式 | plan 包含 tool 消息应排除。 | 消息上下文只含 user + assistant，不含 tool 消息 |
| 10 | 🟢 | 整体 | 方案结构清晰，API 选择正确。修复 4 个 🔴 后即可进入 plan-to-tasks。 | — |

---

## 变更 v4：审查修正 [修正]

按审查结论修正 plan.md：

| # | 问题 | 修正方式 |
|---|------|---------|
| 1 | 🔴 `>` 应为 `>=` | `turnCount > auto_refresh_turns + 1` → `turnCount >= auto_refresh_turns + 1` |
| 2 | 🔴 auth.ok 未检查 | 调用 `getApiKeyAndHeaders` 后加 `if (!auth.ok) return;` |
| 3 | 🔴 缺少 try/catch | turn_end handler 用 try/catch 包裹整个生成流程，异常时 ctx.ui.notify |
| 4 | 🔴 getSessionName() undefined 误判 | 改为 `currentName !== undefined &&` 条件 |
| 5 | 🟡 配置缺失降级未定义 | 不存在时自动创建默认配置 |
| 6 | 🟡 无 provider 前缀的 model ID | parseModelRef 要求必须带 `/`，否则返回 undefined |
| 7 | 🟡 ctx.model 可能为 undefined | 使用前 `if (!model) return;` |
| 8 | 🟡 timestamp 不一致 | appendEntry 数据统一包含 `title, lastEntryId, timestamp` |
| 9 | 🟡 tool 消息应排除 | 消息上下文只含 user + assistant，去掉 tool 消息 |
