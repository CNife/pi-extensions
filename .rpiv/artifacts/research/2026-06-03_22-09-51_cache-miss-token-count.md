---
date: 2026-06-03T22:09:51+0800
author: CNife
commit: "636c437"
branch: main
repository: pi-extensions
topic: "cache-hit-rate 缓存失效 token 计数"
tags: [research, codebase, cache-hit-rate, footer, metrics]
status: complete
last_updated: 2026-06-03T22:09:51+0800
last_updated_by: CNife
---

# Research: cache-hit-rate 缓存失效 token 计数

## Research Question

在 `packages/cache-hit-rate` 插件中新增 M (Miss) 和 R (Cache Real Hit Rate) 指标，移除 R10 (Recent N) 滑动窗口，将 footer 从三均线简化为双尺度 + R + M。核心问题：如何在不改变现有事件驱动架构的前提下，通过跨请求对比缓存状态变化来推断缓存失效量，并确保 `buildState()` 全量重建和 `message_end` 增量更新两条路径的一致性。

## Summary

整个插件实现在单文件 `packages/cache-hit-rate/extensions/cache-hit-rate.ts`（~370 行）中。变更涉及 4 个逻辑层（配置、状态、格式化、事件），约 39 行需要修改或删除。

核心机制：`Miss = max(0, prevPromptTokens − current.cacheRead)`，其中 `prevPromptTokens` 是上一次请求的 `input + cacheRead + cacheWrite`（即 `Sample.promptTokens`）。Miss 在两条代码路径中计算——`buildState()` 遍历 `getBranch()` 时逐对比较相邻样本，`message_end` 增量更新时使用 `state.prevPromptTokens` 字段。两条路径代数等价（`getBranch()` 按时间序返回条目）。

**R 公式修正**：`R = (1 − totalMissTokens / totalInputTokens) × 100`，其中 `totalInputTokens = totalPromptTokens − totalCacheReadTokens = Σ(input + cacheWrite)`。R 与 T 是真正不同的指标——T 衡量缓存命中率（cacheRead/promptTokens），R 衡量 miss 相对于非缓存 token 的比例。

## Detailed Findings

### CacheMetrics 状态类型传播

`CacheMetrics` 类型（`cache-hit-rate.ts:137-142`）通过 5 个消费者传播，所有消费者共享同一个可变 `state` 对象（`cache-hit-rate.ts:328`）：

- **`createEmptyState()`**（`:144-151`）：初始化 `state`。移除 `recentSamples: []`，新增 `totalMissTokens: 0`、`prevPromptTokens: 0`
- **`buildState()`**（`:178-215`）：全量重建。移除 `recentN` 参数和 `recentSamples` 局部变量，新增 miss 累计逻辑。`Object.assign(state, fresh)` 覆盖所有字段
- **`formatStatus()`**（`:261-299`）：footer 输出。移除 `calcWeightedPercent(state.recentSamples)` 调用，新增 R 公式和 `fmtCompact()` 紧凑格式
- **`publishCacheHitRate()`**（`:303-308`）：纯透传，类型变更自动传播
- **`message_end` handler**（`:355-369`）：增量更新。移除 `recentSamples.push/shift`，新增 miss 计算和 `prevPromptTokens` 更新

**关键约束**：`prevPromptTokens` 是 `buildState()` 和 `message_end` 之间的桥梁。`buildState()` 必须将遍历中最后一个样本的 `promptTokens` 设为 `prevPromptTokens`，否则 `message_end` 的首次 miss 计算会基于错误的基线。

### buildState() 全量重建路径

`buildState()` 单次遍历 `getBranch()` 条目（`cache-hit-rate.ts:185`），维护累计器：

- 遇 `model_change`/`compaction`（`:186-191`）时重置所有累计器：`totalCacheReadTokens = 0`、`totalPromptTokens = 0`、`current = null`。**新增**：`totalMissTokens = 0`、`prevPromptTokens = 0`
- 对每个有效 assistant 消息，先计算 `miss = max(0, prevPromptTokens - sample.cacheRead)`，累加到 `totalMissTokens`，**然后**更新 `prevPromptTokens = sample.promptTokens`（顺序关键）
- 返回时 `prevPromptTokens` 持有最后一个有效样本的 `promptTokens`

### message_end 增量更新路径

`message_end` handler（`cache-hit-rate.ts:355-369`）是最高频代码路径（每次 assistant 回复触发）：

1. 读取 `state.prevPromptTokens`（来自 `buildState()` 或上一次 `message_end`）
2. 计算 `miss = Math.max(0, state.prevPromptTokens - sample.cacheRead)`
3. 累加 `state.totalMissTokens += miss`
4. 更新 `state.prevPromptTokens = sample.promptTokens`（为下次做准备）
5. 设置 `state.current = sample`
6. 累加 `state.totalCacheReadTokens` 和 `state.totalPromptTokens`（不变）

**顺序约束**：miss 计算必须在 `prevPromptTokens` 更新之前完成。`state.current = sample` 可安全放在 miss 计算之后（`prevPromptTokens` 是独立字段）。

### 双路径等价性

两条路径代数等价的前提：

1. `getBranch()` 按 root→leaf 时间序返回条目（已确认：`session-manager.js:792-801` 使用 `path.unshift(current)` 从 leaf 向 root 遍历，产出 root→leaf 序）
2. 两条路径使用相同的 `getUsageSample()` 过滤逻辑
3. 两条路径在相同的 `model_change`/`compaction` 边界重置

### formatStatus() 与 R 公式

新 R 公式：`R = (1 − totalMissTokens / totalInputTokens) × 100`，其中 `totalInputTokens = totalPromptTokens − totalCacheReadTokens`（可在 `formatStatus()` 中计算，无需新增状态字段）。

R 与 T 是不同指标：

- T = `totalCacheReadTokens / totalPromptTokens`（缓存命中率）
- R = `1 − totalMissTokens / (totalPromptTokens − totalCacheReadTokens)`（miss 相对于非缓存 token 的效率）

R 复用现有 `colorRules`（越高越好，无需反转颜色逻辑）。M 使用 `fmtCompact()` 紧凑格式（9.0k / 1.2M），不着色。

### Usage 接口约束

`Usage` 接口（`types.d.ts:169-182`）定义 5 个 token 字段：`input`、`output`、`cacheRead`、`cacheWrite`、`totalTokens`。`getUsageSample()`（`cache-hit-rate.ts:155-164`）计算 `promptTokens = input + cacheRead + cacheWrite`，这正是 FRD 所需的 `prevPromptTokens`。`cacheWrite` 包含在 `promptTokens` 中但不单独计入 miss——它是首次写入缓存的 token，在当前请求中不是 hit，但会在未来请求中变为 `cacheRead`。

### 配置简化 (recentN 移除)

完整的删除清单（~39 行）：

- `CacheHitRateConfig` 类型（`:26`）：移除 `recentN: number`
- `DEFAULT_CONFIG`（`:31`）：移除 `recentN: 10`
- `loadConfig()`（`:102,108,109,127`）：移除 `recentN` 类型检查、最小值检查、返回值
- `buildState()` 签名（`:179`）：移除 `recentN` 参数
- `buildState()` 内部（`:182,189,205,208-209,213`）：移除 `recentSamples` 相关逻辑
- `calcWeightedPercent()`（`:167-175`）：整函数删除
- `formatStatus()`（`:267,275,287-292,298`）：移除 R10 显示
- 入口函数（`:326,330,336,342,348`）：移除 `recentN` 解构和传参
- `message_end`（`:361-363`）：移除 `recentSamples.push/shift`

## Code References

- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:26-28` — `CacheHitRateConfig` 类型定义（需移除 `recentN`）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:30-38` — `DEFAULT_CONFIG`（需移除 `recentN: 10`）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:83-128` — `loadConfig()` 函数（需简化 `recentN` 校验）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:137-142` — `CacheMetrics` 类型（需移除 `recentSamples`，新增 `totalMissTokens`/`prevPromptTokens`）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:144-151` — `createEmptyState()` 工厂函数
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:155-164` — `getUsageSample()` — `promptTokens = input + cacheRead + cacheWrite`
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:167-175` — `calcWeightedPercent()`（整函数删除）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:178-215` — `buildState()` 全量重建（核心重写点）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:261-299` — `formatStatus()` footer 输出（核心重写点）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:314-369` — 事件注册与 handler
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:169-182` — `Usage` 接口定义

## Integration Points

### Inbound References

- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:330` — `session_start` 事件触发 `buildState()`
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:336` — `session_tree` 事件触发 `buildState()`
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:342` — `session_compact` 事件触发 `buildState()`（同时重置状态）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:348` — `model_select` 事件触发 `buildState()`（同时重置状态）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:355` — `message_end` 事件触发增量更新

### Outbound Dependencies

- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:3` — `AssistantMessage` 类型（from `@earendil-works/pi-ai`）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:4-7` — `ExtensionAPI`、`ExtensionContext`（from `@earendil-works/pi-coding-agent`）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:8` — `getAgentDir()` 配置路径解析
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:169-182` — `Usage` 接口（`input`/`output`/`cacheRead`/`cacheWrite`/`totalTokens`）

### Infrastructure Wiring

- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:18` — `CONFIG_PATH` 配置文件路径
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:328` — 共享可变 `state` 对象（所有 handler 的核心桥接）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:331,337,343,349` — `Object.assign(state, fresh)` 桥接全量重建与共享状态

## Architecture Insights

1. **单文件架构**：整个插件在 ~370 行的单 TypeScript 文件中实现，包含配置管理、状态计算、格式化和事件注册。变更影响范围可控
2. **共享可变状态模式**：所有 handler 通过闭包共享同一个 `state` 对象。`buildState()` 通过 `Object.assign()` 覆盖字段，`message_end` 直接变异。新增字段必须在两处都正确处理
3. **双路径一致性要求**：`buildState()` 和 `message_end` 必须产生相同的累计结果。`prevPromptTokens` 是两条路径之间的关键桥梁——`buildState()` 设置初始值，`message_end` 读取并更新
4. **model_change/compaction 重置语义**：所有累计器（包括新增的 `totalMissTokens`/`prevPromptTokens`）必须在这两个事件时归零。这是现有代码已验证的模式
5. **配置驱动的 fail-soft**：配置加载失败时显示 "cache config error" 并 early return。移除 `recentN` 后，配置仅剩 `colorRules`，简化了校验逻辑
6. **无测试文件**：包内没有测试文件。之前的变更通过手动 e2e 测试验证（7 个场景）

## Precedents & Lessons

3 次相关变更分析。

### Precedent: 初始插件创建

**Commit(s)**: `7c026c7` — "新增缓存命中率扩展" (2026-05-30)
**Blast radius**: 3 文件，308 行新增
  packages/cache-hit-rate/ — 完整包结构

**Follow-up fixes**:

- `27f9ee9` — "三均线指标体系：重写cache-hit-rate插件" (2026-05-30) — 创建当天即完全重写

**Takeaway**: 初始实现仅存活数小时即被替代，第一个版本从未进入主分支

### Precedent: 三均线重写

**Commit(s)**: `27f9ee9` — "三均线指标体系：重写cache-hit-rate插件" (2026-05-30)
**Blast radius**: 8 文件，3 层（+325/-171 行）
  packages/cache-hit-rate/extensions/cache-hit-rate.ts — 核心逻辑
  changes/20260530-refactor-cache-hit-rate/ — 5 个计划文档

**Follow-up fixes**:

- `259fef5` — "代码审查polish" (2026-05-30) — 审查后修正：措辞、浮点 epsilon 注释、防御性 fallback

**Lessons from docs**:

- `changes/20260530-refactor-cache-hit-rate/change.md` — 6 轮变更迭代，审查 v5 发现 2 个阻塞性问题：配置路径硬编码错误（`~/.pi/agent/` vs `getAgentDir()`）、`CacheMetrics.recentSamples` 类型错误（单例 vs 数组）

**Takeaway**: 状态类型和初始化 bug 是最高风险——`prevPromptTokens`/`totalMissTokens` 的类型和生命周期必须从一开始设计正确

### Composite Lessons

- 状态初始化 bug 是最昂贵的审查发现（`27f9ee9` 审查 v5 捕获了 `recentSamples` 类型错误和配置路径错误，若进入实现阶段需重写整个 `buildState()`）
- 所有累计器必须在 model_change/compaction 时同步重置（`27f9ee9` 建立的模式），新增的 `totalMissTokens`/`prevPromptTokens` 必须遵循
- 双路径（全量重建 vs 增量更新）一致性是核心正确性要求——`prevPromptTokens` 桥梁字段是关键

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-06-03_21-46-17_cache-miss-token-count.md` — FRD：完整的缓存失效指标需求定义

## Developer Context

**Q (discover: 缓存失效的定义与算法)**: Miss = 上次请求的非 output token 中，本次未命中缓存的部分。公式：`max(0, prevPromptTokens − current.cacheRead)`
A: `prevPromptTokens` = 上次请求的 `input + cacheRead + cacheWrite`，`cacheWrite` 不计入 miss

**Q (discover: 成本度量方式)**: 不需要算多付的价格，只计算 miss 的 token 数量
A: 纯 token 计数，非美元金额

**Q (discover: Footer 展示方式)**: 更新现有 footer 格式为 `Cache C:xx.xx T:xx.xx R:xx.xx M:x.xk`
A: M 与 C/T/R 并列

**Q (discover: 移除 R10)**: 移除 Recent N 滑动窗口
A: 简化 footer 显示

**Q (discover: M 的时间范围)**: 会话累计
A: 累计值与 T 语义一致

**Q (discover: M 的重置行为)**: 跟随 C/T 重置
A: model_change/compaction 后归零

**Q (discover: M 的颜色编码)**: 不着色
A: token 绝对值无通用阈值

**Q (discover: R 指标方向)**: Cache Real Hit Rate (越高越好)
A: 复用 C/T 颜色规则

**Q (developer correction): R 公式修正**: R 的分母应为 `totalInputTokens`（非 `totalPromptTokens`）
A: `R = (1 − totalMissTokens / totalInputTokens) × 100`，其中 `totalInputTokens = totalPromptTokens − totalCacheReadTokens`。R 与 T 是真正不同的指标

## Related Research

- `.rpiv/artifacts/research/2026-06-01_21-46-35_pi-extension-api-patterns.md` — pi 扩展 API 模式

## Open Questions

（无延迟项）
