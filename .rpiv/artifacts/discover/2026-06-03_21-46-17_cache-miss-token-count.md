---
date: 2026-06-03T21:46:17+0800
author: CNife
commit: 636c437
branch: main
repository: pi-extensions
topic: "cache-hit-rate 缓存失效 token 计数"
tags: [intent, frd, cache-hit-rate]
status: complete
last_updated: 2026-06-03T21:46:17+0800
last_updated_by: CNife
---

# FRD: cache-hit-rate 缓存失效 token 计数

## Summary

在 `packages/cache-hit-rate` 插件中新增 M (Miss) 指标，通过跨请求对比缓存状态变化来推断缓存失效量。Miss = 上一次请求的非 output token 总量 − 本次请求的 cacheRead。同时新增 R (Cache Real Hit Rate) = 1 − Miss/TotalInput，显示为百分比（越高越好）。移除 R10 (Recent N) 时间尺度，将 footer 从三均线简化为双尺度 + miss rate + miss 计数。

## Problem & Intent

终端用户运行 pi 时看到 API 调用费用，想知道缓存没命中多花了多少钱。核心需求是**捕获没有命中被动缓存的请求，计算缓存失效抬高成本的程度**。用户最终定义"成本"为 token 数量而非美元金额——关注的是"有多少 token 本应命中缓存但实际没有"。

**缓存失效模型**（开发者原话）：

- 第一次请求 input=[A,B]，A 是之前缓存的消息（cacheRead），B 是新消息（不会被缓存，不算 miss）
- 第二次请求 input=[A,B,C]，预期 A+B 一起被缓存，但实际只有 A 触发 cacheRead
- **Miss = B**：上次请求中存在的非 output token，本次请求中未命中缓存的部分
- C 是新消息，不算 miss

**公式**：`Miss(current) = max(0, prevPromptTokens − current.cacheRead)`

- `prevPromptTokens` = 上一次请求的 `input + cacheRead + cacheWrite`（即应被缓存的全部内容）
- `current.cacheRead` = 本次请求实际命中缓存的部分
- 首次请求（无前序状态）：miss = 0

## Goals

- 在 footer 中新增 M (Miss) 指标，显示会话累计的缓存失效 token 数
- 在 footer 中新增 R (Cache Real Hit Rate) 指标，显示 `1 − totalMissTokens / totalPromptTokens` 的百分比（越高越好）
- 简化 footer 显示：从三时间尺度 (C/R10/T) 缩减为双尺度 (C/T) + Miss Rate + Miss 计数
- 保持与现有 C/T 指标一致的生命周期（model_change/compaction 时重置）

## Non-Goals

- 不计算美元成本差额（不需要模型定价查找）
- 不为 M 指标设置颜色编码规则
- 不修改 C/T 命中率的计算逻辑
- `cacheWrite` token 不计入 miss（首次写入缓存的 token 本来就不会被命中）

## Functional Requirements

1. 系统 SHALL 在每次 `message_end` 事件中，用 `max(0, prevPromptTokens − current.cacheRead)` 计算本次请求的 miss token 数，累加到 `state.totalMissTokens`
2. `prevPromptTokens` SHALL 为上一次 assistant message 的 `input + cacheRead + cacheWrite`（即 `Sample.promptTokens`）
3. 首次请求（`state` 无前序样本时）miss SHALL 为 0
4. 系统 SHALL 在 footer 中以 `Cache C:{percent} T:{percent} R:{percent} M:{count}` 格式显示四个指标
5. R 值 SHALL 为 `(1 − totalMissTokens / totalPromptTokens) × 100`，显示为百分比（如 `R:87.66`），越高表示缓存有效率越高
6. R 值 SHALL 复用现有颜色规则（与 C/T 相同阈值着色，高=绿，低=红）
7. M 值 SHALL 采用紧凑格式显示（如 `9.0k` 表示 9000，`1.2M` 表示 1200000）
8. M/R 值 SHALL 在 `model_change` 和 `compaction` 事件时归零，与 C/T 保持一致
9. 系统 SHALL 移除 Recent N (R10) 滑动窗口的计算和显示逻辑
10. 全量重建 (`buildState`) 和增量更新 (`message_end`) 两条路径 SHALL 同步支持 miss token 统计

## Non-Functional Requirements

- **Performance**: 无新增约束，复用现有事件驱动架构
- **Security**: 不涉及
- **UX / Accessibility**: M 使用默认颜色（不着色），R 复用 C/T 的颜色规则（越高越好：高=绿，低=红），C/T 保持现有颜色规则。三个百分比指标语义一致
- **Reliability**: 配置加载失败时的 fail-soft 行为不变（显示 "cache config error"）

## Constraints & Assumptions

- 不需要调用 `calculateCost()` API——M 是纯 token 计数，不依赖模型定价
- **核心假设**：上一次请求的 prompt 内容在本次请求中应当全部命中缓存。这在 Anthropic prompt caching 中通常成立，除非发生缓存过期（5min TTL）、模型切换、或 compaction
- `message.usage` 中 `cacheWrite` 是首次写入缓存的 token，不算 miss
- 需要新增 `prevPromptTokens` 状态字段来追踪上一次请求的非 output token 总量
- miss 值可能出现负数（如上次 compaction 导致 prompt 缩短），此时应 clamp 为 0

## Acceptance Criteria

- [ ] Footer 显示格式为 `Cache C:xx.xx T:xx.xx R:xx.xx M:x.xk`，其中 C/T/R 为百分比，M 为紧凑数字
- [ ] R = (1 − totalMissTokens / totalPromptTokens) × 100，随 miss 累计实时更新，越高越好
- [ ] 首次请求：M = 0, R = 0（无前序状态，不算 miss）
- [ ] 后续请求：M 增加 `max(0, prevPromptTokens − currentCacheRead)`，R 随之更新
- [ ] 切换模型后，M/R 值和 prevPromptTokens 均归零
- [ ] 发生 compaction 后，M/R 值和 prevPromptTokens 均归零
- [ ] R10 相关代码和配置项 (`recentN`) 已被移除
- [ ] `buildState()` 全量重建路径正确逐消息计算并累加 miss token

## Recommended Approach

在 `packages/cache-hit-rate/extensions/cache-hit-rate.ts` 中扩展 `CacheMetrics` 状态新增 `totalMissTokens` 累计器和 `prevPromptTokens` 追踪字段。在 `buildState()` 全量重建时遍历消息序列逐条计算 miss 并累加；在 `message_end` 增量更新时用前一条样本的 `promptTokens` 减去当前 `cacheRead` 计算 miss。R = `(1 − totalMissTokens / totalPromptTokens) × 100`，复用现有颜色规则（越高越好）。修改 `formatStatus()` 输出双尺度 + R + M 格式，移除 `recentSamples`、`recentN` 和 `calcWeightedPercent()` 相关逻辑。

## Decisions

### 缓存失效的定义与算法

**Question**: "缓存未命中"具体如何定义？`message.usage` 中哪些 token 算 miss？
**Recommended**: n/a — `intent` question
**Chosen**: Miss = 上次请求的非 output token 中，本次未命中缓存的部分。公式：`max(0, prevPromptTokens − current.cacheRead)`。其中 `prevPromptTokens` = 上次请求的 `input + cacheRead + cacheWrite`，`cacheWrite` 本身不计入 miss（首次写入不会被命中）
**Rationale**: 开发者给出了具体场景：R1 input=[A,B] → R2 input=[A,B,C] 中只有 A 命中缓存，miss=B。跨请求对比是唯一能从 usage 数据推断 miss 的方式

### 成本度量方式

**Question**: 计算成本差额需要模型定价。pi-ai 库已有 calculateCost(model, usage) 函数和完整的模型定价结构 (input/output/cacheRead/cacheWrite 单价)。用这个内置定价,还是自定义?
**Recommended**: 用 pi-ai 内置定价 (models.d.ts:9, types.d.ts:481-488)
**Chosen**: 不需要算多付的价格，只计算 miss 的 token 数量（非美元金额）
**Rationale**: 用户关注的是缓存失效的 token 规模，而非精确的美元差额。token 计数更直观且不依赖定价数据

### Footer 展示方式

**Question**: 成本差额信息如何展示给终端用户?当前插件在 footer 状态栏显示三个时间尺度的命中率。
**Recommended**: 追加到现有 footer
**Chosen**: 更新现有 footer 格式为 `Cache C:12.34 T:56.78 M:9.0k`，其中 M 表示本来应命中缓存但实际没有命中的 tokens 数量
**Rationale**: 保持 footer 信息密度，M 与 C/T 并列提供完整的缓存健康视图

### 移除 R10 (Recent N)

**Question**: 你在例子中去掉了 R10 (Recent N 滑动窗口均值)。是否确认移除这个时间尺度？
**Recommended**: 移除 R10
**Chosen**: 移除 R10
**Rationale**: 简化 footer 显示，Recent N 滑动窗口在加入 M 指标后信息冗余

### M 的时间范围

**Question**: footer 中的 M (Miss) 显示的是单次请求的未命中 token 数，还是会话累计总量？你的例子 M:9.0k 是哪个？
**Recommended**: 会话累计
**Chosen**: 会话累计
**Rationale**: 累计值反映整个会话的缓存失效总量，与 T (Total) 的语义一致

### M 的重置行为

**Question**: 当切换模型或发生 compaction 时，现有代码会重置 C 和 T 的累计数据 (cache-hit-rate.ts:186-191)。M (累计 miss token) 是否跟随同样的重置规则？
**Recommended**: 跟随 C/T 重置 (Recommended)
**Chosen**: 跟随 C/T 重置
**Rationale**: 三个指标共享同一生命周期，model_change/compaction 后缓存语义已改变，旧数据不再有意义

### M 的颜色编码

**Question**: C 和 T 的命中率有颜色规则（红/黄/默认/绿）。M 是绝对 token 数量，是否也需要颜色编码？
**Recommended**: 不着色 (Recommended)
**Chosen**: 不着色
**Rationale**: token 绝对值没有通用的"好坏"阈值，不同模型/会话长度差异巨大，着色容易产生误导

### R (Cache Real Hit Rate) 指标

**Question**: R 用哪个方向？Miss Rate (Miss/TotalInput, 越高越差) 还是 Cache Real Hit Rate (1−Miss/TotalInput, 越高越好)?
**Recommended**: Cache Real Hit Rate (Recommended)
**Chosen**: Cache Real Hit Rate, R = (1 − totalMissTokens / totalPromptTokens) × 100
**Rationale**: 与 C/T 语义一致（越高越好），复用现有 colorRules 无需反转颜色逻辑。T ≥ R，差值直观反映缓存失效程度

## Open Questions

（无延迟项）

## Suggested Follow-ups

- 缓存过期（Anthropic 5min TTL）导致的 miss 与内容变化导致的 miss 无法从 usage 数据区分——如需精细化分析，可考虑结合请求时间戳做 TTL 过期检测

## References

- `packages/cache-hit-rate/extensions/cache-hit-rate.ts` — 现有实现（~330 行）
- `changes/20260530-refactor-cache-hit-rate/` — 上一次重构的设计文档（三均线体系）
- `node_modules/@earendil-works/pi-ai/dist/types.d.ts:169-182` — `Usage` 接口定义（input/output/cacheRead/cacheWrite 字段）
