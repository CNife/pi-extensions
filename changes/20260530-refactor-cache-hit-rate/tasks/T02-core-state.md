---
status: 已完成
priority: 高
depends_on: [T01-config-module]
---

# T2: 核心状态与采样逻辑

**目标**：替换旧的类型和函数，实现多指标状态模型和加权平均计算。

**涉及文件**：

- `packages/cache-hit-rate/extensions/cache-hit-rate.ts`

**具体内容**：

1. 移除旧类型和常量：`CacheHitRateState`、`UsageSample`、`TREND_WINDOW_SIZE`、`MAX_TREND_SAMPLES`、`MIN_TREND_PROMPT_TOKENS`、`EMPTY_TEXT`
2. 新增类型：

   ```ts
   type Sample = { cacheRead: number; promptTokens: number };
   type CacheMetrics = {
     current: Sample | null;
     recentSamples: Sample[];
     totalCacheReadTokens: number;
     totalPromptTokens: number;
   };
   ```

3. 新增函数：
   - `createEmptyState()` → `{ current: null, recentSamples: [], totalCacheReadTokens: 0, totalPromptTokens: 0 }`
   - `getUsageSample(msg)` → 去掉 `MIN_TREND_PROMPT_TOKENS` 判断，`promptTokens > 0` 即有效
   - `calcWeightedPercent(samples)` → 按 prompt token 加权计算命中率；空数组返回 null
   - `buildState(sessionManager, recentN)` → **单次遍历** `getBranch()`：
     - 从前往后扫描，累积 Total（`totalCacheReadTokens` + `totalPromptTokens`）
     - 遇到 `model_change` 或 `compaction` entry → 清空 Total 累积和 recentSamples，继续
     - 遍历结束后，`recentSamples = recentSamples.slice(-recentN)`
     - `current` = 最后一条 assistant message 的 sample（可能为 null）
4. 移除旧函数：`addToCumulativeTotals`、`pushTrendSample`、`resetTrendSamples`、`replaceState`、`calculatePercent`、`colorizeByCumulativeRate`、`colorizeByDelta`、`formatDelta`、`buildState`（旧版）

**验证方式**：

- 构造模拟 sessionManager（含 model_change entry），验证 buildState 在遇到 model_change 时 Total 和 recentSamples 正确重置
- 验证加权平均：两条样本 token 量不同时，结果偏向 token 大的样本
- 验证 `getBranch()` 中仅 `model_change` 和 `compaction` entry 触发重置，`message` entry 不触发
