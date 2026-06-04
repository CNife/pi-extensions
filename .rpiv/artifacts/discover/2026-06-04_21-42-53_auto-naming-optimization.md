---
date: 2026-06-04T21:42:53+08:00
author: CNife
commit: 0d7be14
branch: main
repository: pi-extensions
topic: "auto-naming-session 触发时机与 prompt 优化"
tags: [intent, frd, auto-naming-session]
status: complete
last_updated: 2026-06-04T21:42:53+08:00
last_updated_by: CNife
---

# FRD: auto-naming-session 触发时机与 prompt 优化

## Summary

重构 auto-naming-session 扩展的触发模型和 prompt 策略。将触发事件从 `turn_end`（每次 LLM 调用后）改为 `agent_end`（一个完整用户对话结束后），阈值判断改为累积消息数 ≥ 阈值即触发，首次生成改为第一条 user message 后立即执行，同时优化 prompt 指令使 LLM 关注整体会话而非近期操作。

## Problem & Intent

当前 auto-naming-session 监听 `turn_end` 事件，而一个 agent run 内包含多个 turn（每次 LLM 调用 = 一个 turn），导致标题生成评估时机碎片化。同时 prompt 只传入增量消息且指令未引导全局视角，LLM 容易过于关注近期操作细节，忽略整体会话主题。首次生成也需要等第一个 turn 结束，不够及时。

开发者目标：稳定生成时机、减少不必要的生成、利用 assistant 回复提高标题质量。

## Goals

- 触发时机稳定在 agent run 结束后，避免一个 agent run 内多次评估
- 阈值判断改为累积式（消息数 ≥ 阈值即触发），不再依赖 turnIndex 精确取模
- 首次生成在第一条 user message 后立即完成，无需等待 agent run
- Prompt 引导 LLM 关注整体会话主题，而非近期操作细节

## Non-Goals

- 不改变增量 transcript 传入方式（依然只传 lastEntryId 之后的消息）
- 不改变手动标题保护逻辑（isTitleManuallyChanged）
- 不改变配置键名 `auto_refresh_turns`
- 不改变扩展入口结构和配置加载方式

## Functional Requirements

1. 扩展 SHALL 监听 `agent_end` 事件替代 `turn_end`，作为标题刷新的评估时机
2. 每次 `agent_end` 触发时 SHALL 计算 `lastEntryId` 之后的 user + assistant 消息总数，若 ≥ `auto_refresh_turns` 则触发标题生成
3. 扩展 SHALL 监听 `message_end` 事件，当检测到第一条 user role 消息且尚未生成过标题（`lastEntryId === null`）时，立即以该消息为 transcript 生成首次标题
4. 首次生成后 SHALL 更新 `lastEntryId` 为当前 leaf entry ID
5. System prompt SHALL 包含明确指令，引导 LLM 考虑整体会话的主题、关键目标和主要方向，而非关注最近的消息细节
6. User prompt SHALL 使用 "Synthesize the full scope of this conversation" 类措辞替代当前的 "Generate a concise title"
7. 保留 `isTitleManuallyChanged` 手动标题保护逻辑，用户手动改名后跳过自动刷新

## Non-Functional Requirements

- **Performance**: 无特殊约束。LLM 调用仍为异步，不阻塞 agent 流程
- **Security**: 无变化。认证机制沿用现有 `modelRegistry.getApiKeyAndHeaders`
- **UX / Accessibility**: 首次标题应在用户发送第一条消息后尽快出现，减少"无标题"状态的等待感
- **Reliability**: 无变化。错误处理沿用现有的 `stopReason` 检查和 `ui.notify` 通知

## Constraints & Assumptions

- `agent_end` 事件在 pi extensions API 中已存在（`extensions.md:503`），携带 `event.messages`
- `message_end` 事件可用于检测首条 user 消息，通过 `ctx.sessionManager.getBranch()` 判断是否为第一条
- `auto_refresh_turns` 配置键名保持不变，语义从"turn 取模间隔"变为"消息数阈值"，配置值 10 在新语义下仍合理
- `buildTranscript` 函数的增量逻辑（从 lastEntryId 之后收集 user/assistant 消息）保持不变

## Acceptance Criteria

- [ ] 发送第一条 user message 后，会话标题在 agent 开始处理前即生成并显示
- [ ] 一个 agent run 内多次 LLM 调用（多 turn）只触发一次 `agent_end`，不会重复评估
- [ ] `lastEntryId` 之后的 user + assistant 消息数 < 阈值时，`agent_end` 不触发生成
- [ ] `lastEntryId` 之后的 user + assistant 消息数 ≥ 阈值时，`agent_end` 触发生成并更新 lastEntryId
- [ ] 手动修改标题后，后续 `agent_end` 不再自动覆盖
- [ ] 生成的标题不超过 60 字符
- [ ] `shouldGenerateTitle` 函数接收消息计数和阈值，返回 boolean

## Recommended Approach

修改 `packages/auto-naming-session/extensions/index.ts` 单文件。新增 `agent_end` 和 `message_end` 事件监听，替代现有 `turn_end` 监听。重写 `shouldGenerateTitle` 为消息数阈值判断。优化 system/user prompt 措辞。

## Decisions

### 触发事件改为 agent_end

**Question**: 当前 `turn_end` 在一个 agent run 内会触发多次，应改为什么事件？
**Recommended**: `agent_end` — 每个用户对话只触发一次，避免碎片化评估
**Chosen**: `agent_end`
**Rationale**: 开发者明确"只在 turn（此处指完整 agent run）结束时触发"

### 阈值判断改为累积式

**Question**: 当前用 `turnIndex >= N && turnIndex % N === 0` 精确取模，应改为什么？
**Recommended**: 累积 ≥ 阈值即触发 — 不会因 agent run 跨过的 turn 数不均匀而漏触发
**Chosen**: 累积 ≥ 阈值即触发
**Rationale**: 开发者确认"累积 ≥ 阈值就触发"

### 计数方式：user + assistant 消息总数

**Question**: "距上次生成以来的消息数"具体如何计算？
**Recommended**: 遍历 `lastEntryId` 之后的 branch entries，统计 role 为 user 或 assistant 的 message 数量
**Chosen**: user + assistant 消息总数
**Rationale**: 开发者确认这是其原始描述中的计数方式

### Prompt 优化方向：强调全局视角

**Question**: 当前 prompt 导致 LLM 过于关注近期操作，应如何优化？
**Recommended**: System prompt 加 "Consider the overall conversation arc, key topics, and primary goals rather than focusing on the most recent messages"；User prompt 改为 "Synthesize the full scope of this conversation"
**Chosen**: 强调全局视角
**Rationale**: 开发者选择推荐方案

### 首次生成事件：message_end 检测首条

**Question**: 首次生成不等 agent run 结束，应监听什么事件？
**Recommended**: `message_end` — 检测当前 message 是否为第一条 user role 消息
**Chosen**: `message_end` 检测首条
**Rationale**: 开发者选择此方案，可在 user 消息落盘后立即生成

### 保留手动标题保护

**Question**: 当前 `isTitleManuallyChanged` 逻辑（`index.ts:276-278`）是否保留？
**Recommended**: 保留 — 用户手动改名后不自动覆盖
**Chosen**: 保留
**Rationale**: `evidence: index.ts:276-278 + confirmed`

### 配置键名不变

**Question**: `auto_refresh_turns` 配置键名是否需要改为反映新语义？
**Recommended**: 不变 — 单位仍可理解为 turn/message 阈值，避免破坏现有用户配置
**Chosen**: 不变
**Rationale**: `evidence: index.ts:35 + confirmed`

### 首次生成后也更新 lastEntryId

**Question**: 首次生成后是否需要更新 `lastEntryId`？
**Recommended**: 是 — 后续 `agent_end` 从此点开始计数，避免重复计算首次消息
**Chosen**: 是
**Rationale**: `evidence: index.ts:366 + confirmed`

## Open Questions

（无 — 所有关键节点均已做出决策）

## Suggested Follow-ups

- 阈值默认值 10 在新语义下（user+assistant 消息数）是否仍合适，可在实际使用后根据体验微调 — `index.ts:35`
- `buildTranscript` 目前只提取 TextContent，忽略 tool_use/tool_result 内容，如果后续需要更丰富的上下文可以考虑扩展 — `index.ts:175-227`

## References

- 输入：用户 free-text 描述（4 点优化需求）
- 源码：`packages/auto-naming-session/extensions/index.ts`（384 行，唯一源码文件）
- pi 事件生命周期：`@earendil-works/pi-coding-agent/docs/extensions.md:286-302`
