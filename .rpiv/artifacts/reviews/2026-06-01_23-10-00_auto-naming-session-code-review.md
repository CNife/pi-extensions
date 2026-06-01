---
date: 2026-06-01T23:10:00+0800
author: CNife
commit: 8e1e01d
branch: auto-naming-session-plan
repository: pi-extensions
topic: "Code review: @cnife/pi-auto-naming-session"
tags: [review, auto-naming-session, code-review]
status: complete
---

# Code Review: @cnife/pi-auto-naming-session

**Scope**: `cb29b02..8e1e01d` (first-parent, 3 commits, feature branch vs main)
**Files**: 9 changed (2 new, 2 modified, 4 deleted, +1560 −400)
**Core code**: `packages/auto-naming-session/extensions/index.ts` (371 lines, NEW)

## Review Findings

| # | Severity | Dimension | Finding | Recommendation |
|---|----------|-----------|---------|----------------|
| 1 | suggestion | code-quality | `STATUS_KEY` 硬编码为 `"auto-naming"` 字面量，cache-hit-rate 使用命名常量 | 提取为 `const STATUS_KEY = "auto-naming"` |
| 2 | suggestion | code-quality | `ctx.ui.setStatus` 在 config 错误路径内联调用，未抽取为独立函数 | cache-hit-rate 模式可参考但不强制 |
| 3 | concern | architecture | **未注册 `session_tree` / `session_compact` / `model_select` 事件** | 可选增强：navigate/compact 后需重新评估标题（当前为按 turnIndex 刷新，非阻塞） |
| 4 | concern | correctness | `buildTranscript` 用 `entry.id === lastEntryId` 搜索起点，但 `getBranch()` 可能返回含 `undefined` id 的条目 | 需确认所有 entry 都有稳定的 `id` 字段（测试已验证正常） |
| 5 | note | precedent | 仓库内首创：首次使用 `completeSimple` + `setSessionName` + `appendEntry` | 无历史回归风险，但需关注后续兼容性 |
| 6 | note | integration | 无其他包引用此扩展，纯依赖 pi 事件系统 | 松耦合，风险低 |
| 7 | note | testing | 无单元测试（按设计决策） | 纯手动验证，已做 tmux 验证 |

## Precedent Lessons Applied

| 教训 | 状态 |
|------|------|
| 新建包后同步 lockfile（cache-hit-rate CI 失败教训） | ✅ 已包含 `package-lock.json` |
| package.json 使用 peerDependencies + 正确元数据 | ✅ 已验证 |
| 配置路径用 `getAgentDir()` 而非硬编码 | ✅ `index.ts:27` |
| 事件驱动而非命令驱动 | ✅ 无 `registerCommand` |
| plan 审查通过后才实施 | ✅ 5 项 pre-review finding 已全部修复 |

## Peer Comparison (vs cache-hit-rate)

| 维度 | cache-hit-rate | auto-naming-session | 评估 |
|------|---------------|---------------------|------|
| 事件注册 | `message_end` | `turn_end` | ✅ 更合适的粒度 |
| 状态管理 | `buildState()` 独立函数 | 内联在 handler | ⚠️ 可抽取但非必须 |
| 状态发布 | `publishCacheHitRate()` 独立函数 | 内联 | ⚠️ 可抽取但非必须 |
| 通知 | 无 | `ctx.ui.notify()` 用于错误时 | ✅ 更好的用户体验 |
| 配置校验 | 三级校验 + 语义校验 | 三级校验 | ✅ 一致 |
| 状态常量 | `const STATUS_KEY` | 硬编码字面量 | 💡 可改进 |

## Conclusion

**状态: approved** — 无 blocker，2 个 suggestion，2 个 concern。核心功能已通过 tmux 手动验证，增量上下文机制经日志验证正确。`session_tree` 缺失不阻塞（按 turnIndex 刷新已够用）。建议合并前可选修复 STATUS_KEY 常量抽取。
