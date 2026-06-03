---
date: 2026-06-03T22:27:21+0800
author: CNife
commit: "636c437"
branch: main
repository: pi-extensions
topic: "cache-hit-rate 缓存失效 token 计数 — R10 移除 + M/R 指标"
tags: [plan, cache-hit-rate, footer, metrics]
status: ready
parent: ".rpiv/artifacts/research/2026-06-03_22-09-51_cache-miss-token-count.md"
phase_count: 4
unresolved_phase_count: 0
last_updated: 2026-06-03T22:27:21+0800
last_updated_by: CNife
---

# Cache Hit Rate — 缓存失效指标 M/R 与 R10 移除实施计划

## Overview

在 `packages/cache-hit-rate` 插件的现有单文件事件驱动架构中，移除 R10（Recent N）滑动窗口指标，新增 M（Miss — 缓存失效 token 数）和 R（Cache Real Hit Rate — 有效缓存命中率）两个指标。采用与现有代码一致的双路径模式（`buildState()` 全量重建 + `message_end` 增量更新），通过跨相邻请求对比缓存状态变化计算失效量。footer 从三均线简化为双尺度 + R + M。

## Requirements

- [x] 移除 `recentN` 配置项和 R10 footer 显示
- [x] 删除 `calcWeightedPercent()` 函数和 `recentSamples` 状态
- [x] `CacheMetrics` 新增 `totalMissTokens`（累计 miss token 数）和 `prevPromptTokens`（上次请求的 promptTokens 基线）
- [x] Miss 公式：`max(0, prevPromptTokens − current.cacheRead)`，`prevPromptTokens = current.input + current.cacheRead + current.cacheWrite`
- [x] R 公式：`R = (1 − totalMissTokens / totalInputTokens) × 100`，其中 `totalInputTokens = totalPromptTokens − totalCacheReadTokens`
- [x] Footer 格式：`Cache C:xx.xx T:xx.xx R:xx.xx M:x.xk`
  - C/T/R 复用现有 `colorRules` 着色（越高越好）
  - M 使用 `fmtCompact()` 紧凑格式（不着色）
- [x] `buildState()` 和 `message_end` 两条路径代数等价
- [x] `model_change` / `compaction` 事件重置 `totalMissTokens` 和 `prevPromptTokens`
- [x] 更新 README.md 反映新指标

## Current State Analysis

### Key Discoveries

**当前 `CacheMetrics` 状态类型**（`:137-142`）：

```typescript
type CacheMetrics = {
  current: Sample | null;
  recentSamples: Sample[];
  totalCacheReadTokens: number;
  totalPromptTokens: number;
};
```

需移除 `recentSamples`，新增 `totalMissTokens: number` 和 `prevPromptTokens: number`。

**`CacheHitRateConfig` 类型**（`:26-28`）：

```typescript
type CacheHitRateConfig = {
  recentN: number;
  colorRules: ColorRule[];
};
```

移除 `recentN`，配置仅保留 `colorRules`。

**`buildState()` 全量重建**（`:178-215`）：单次 `getBranch()` 遍历，遇 `model_change` / `compaction` 重置累计器。当前维护 `totalCacheReadTokens`、`totalPromptTokens` 和 `recentSamples`（N 滑动窗口）。需移除 `recentN` 参数和滑动窗口逻辑，新增 miss 逐对比较。

**`message_end` 增量更新**（`:355-369`）：当前操作 `recentSamples.push/shift` 维护滑动窗口。需替换为 miss 计算。

**`formatStatus()`**（`:261-299`）：当前显示 `C:xx.xx R{N}:xx.xx T:xx.xx`。需改为 `C:xx.xx T:xx.xx R:xx.xx M:x.xk`。

**无测试文件**：变更验证依赖手动 e2e 测试。

### 现有模式

- 共享可变 `state` 对象通过 `Object.assign()` 桥接全量重建与增量更新
- `model_change` / `compaction` 时所有累计器同步归零
- 配置 fail-soft：加载失败时显示 "cache config error" 并 early return

## Desired End State

### Footer 效果

```text
Cache C:85.50 T:92.10 R:96.30 M:1.2k
```

无数据时显示：

```text
Cache C:--.-- T:--.-- R:--.-- M:--
```

### 配置示例（`cnife-cache-hit-rate.json`）

```json
{
  "colorRules": [
    { "low": 0,  "high": 75,  "color": "error" },
    { "low": 75, "high": 85,  "color": "warning" },
    { "low": 85, "high": 95,  "color": "default" },
    { "low": 95, "high": 100, "color": "success" }
  ]
}
```

`recentN` 已移除，配置仅保留 `colorRules`。

### 核心逻辑示意

```text
buildState() 遍历 getBranch():
  msg1: promptTokens=1500, cacheRead=0    → miss=max(0, 0-0)=0,  prevPromptTokens=1500
  msg2: promptTokens=2000, cacheRead=1200 → miss=max(0, 1500-1200)=300, prevPromptTokens=2000
  msg3: promptTokens=1800, cacheRead=1800 → miss=max(0, 2000-1800)=200, prevPromptTokens=1800
  totalMissTokens=500, totalInputTokens=(1500+2000+1800)-(0+1200+1800)=2300
  R = (1 - 500/2300) × 100 ≈ 78.26
```

## What We're NOT Doing

- **自动化测试**：包内无测试基础架构，验证依赖手动 e2e 测试
- **美元成本计算**：不计算 miss 对应的货币成本
- **其他缓存指标**：不新增除 M/R 外的指标
- **配置向后兼容**：移除 `recentN` 是 breaking change，旧配置文件（含 `recentN`）将被 `loadConfig()` 校验拒绝，需用户删除或更新配置文件
- **版本号更新**：release 时处理

## Decisions

### Decision 1: Miss 定义与算法

- **Ambiguity**: 缓存失效如何量化？
- **Explored**:
  - Option A: 直接不可测量，因为 pi 不暴露缓存逐出事件 → 不可行
  - Option B: 通过对比相邻请求的 `promptTokens` 与 `cacheRead` 推断 → 唯一可行方案
- **Decision**: `Miss = max(0, prevPromptTokens − current.cacheRead)`，其中 `prevPromptTokens` = 上次请求的 `input + cacheRead + cacheWrite`

### Decision 2: R 公式

- **Ambiguity**: 有效缓存命中率的分母是什么？
- **Explored**:
  - Option A: `R = (1 − totalMissTokens / totalPromptTokens) × 100` — 与 T 共享分母，但 R 和 T 的语义趋同（R ≈ T）
  - Option B: `R = (1 − totalMissTokens / totalInputTokens) × 100`，其中 `totalInputTokens = totalPromptTokens − totalCacheReadTokens` — R 与 T 是真正不同的指标
- **Decision**: Option B。R 衡量 miss 相对于非缓存 token 的比例，T 衡量缓存命中率，两者正交

### Decision 3: 双路径一致性设计

- **Constraint**: `buildState()` 全量重建和 `message_end` 增量更新必须产生相同的累计结果
- **Decision**: 引入 `prevPromptTokens` 桥接字段
  - `buildState()` 在遍历结束后将最后一个有效样本的 `promptTokens` 设为 `prevPromptTokens`
  - `message_end` 读取 `state.prevPromptTokens` 作为 miss 计算基线，然后更新为本次的 `promptTokens`
  - 顺序约束：先计算 miss，再更新 `prevPromptTokens`

### Decision 4: M 显示格式

- **Constraint**: Token 绝对值无通用阈值，不适合着色
- **Decision**: M 使用 `fmtCompact()` 紧凑格式（9.0k / 1.2M），不着色，与 C/T/R 用空格分隔

### Decision 5: fmtCompact 实现

- **Constraint**: SDK 无现成的紧凑数字格式化函数
- **Decision**: 内联辅助函数 `fmtCompact()`，参考 SDK 示例 `custom-footer.ts:42` 的 inline `fmt` 模式：

  ```typescript
  function fmtCompact(n: number): string {
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  ```

## Phase 1: 类型系统与工具函数

### Overview

更新类型定义（`CacheMetrics` / `CacheHitRateConfig`）、`DEFAULT_CONFIG`、`loadConfig()` 校验、`createEmptyState()` 工厂函数，并新增 `fmtCompact()` 辅助函数。不修改 `buildState()` / `formatStatus()` / `message_end`。Depends on: nothing (foundation)。

### Changes Required

#### 1. packages/cache-hit-rate/extensions/cache-hit-rate.ts:26-28

**File**: `packages/cache-hit-rate/extensions/cache-hit-rate.ts`
**Changes**: MODIFY — 移除 `CacheHitRateConfig.recentN`

```typescript
type CacheHitRateConfig = {
  colorRules: ColorRule[];
};
```

#### 2. packages/cache-hit-rate/extensions/cache-hit-rate.ts:30-31

**File**: `packages/cache-hit-rate/extensions/cache-hit-rate.ts`
**Changes**: MODIFY — 移除 `DEFAULT_CONFIG.recentN`

```typescript
const DEFAULT_CONFIG: CacheHitRateConfig = {
  colorRules: [
    { low: 0, high: 75, color: "error" },
    { low: 75, high: 85, color: "warning" },
    { low: 85, high: 95, color: "default" },
    { low: 95, high: 100, color: "success" },
  ],
};
```

#### 3. packages/cache-hit-rate/extensions/cache-hit-rate.ts:95-128

**File**: `packages/cache-hit-rate/extensions/cache-hit-rate.ts`
**Changes**: MODIFY — 简化 `loadConfig()`，移除 `recentN` 校验

```typescript
function loadConfig(): CacheHitRateConfig | null {
  if (!existsSync(CONFIG_PATH)) {
    try {
      saveDefaultConfig(CONFIG_PATH);
    } catch {
      return null;
    }
    return { ...DEFAULT_CONFIG };
  }

  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).colorRules)
  ) {
    return null;
  }

  const obj = parsed as { colorRules: unknown[] };

  const rules: ColorRule[] = [];
  for (const r of obj.colorRules) {
    if (
      typeof r !== "object" ||
      r === null ||
      typeof (r as Record<string, unknown>).low !== "number" ||
      typeof (r as Record<string, unknown>).high !== "number" ||
      typeof (r as Record<string, unknown>).color !== "string"
    ) {
      return null;
    }
    rules.push(r as ColorRule);
  }

  if (!validateColorRules(rules)) return null;

  // 拒绝含 recentN 的旧配置文件（breaking change）
  if ("recentN" in obj) {
    return null;
  }

  return { colorRules: rules };
}
```

#### 4. packages/cache-hit-rate/extensions/cache-hit-rate.ts:137-152+

**File**: `packages/cache-hit-rate/extensions/cache-hit-rate.ts`
**Changes**: MODIFY — 更新 `CacheMetrics` 类型定义和 `createEmptyState()` 工厂函数；新增 `fmtCompact()` 辅助函数

```typescript
type CacheMetrics = {
  current: Sample | null;
  totalCacheReadTokens: number;
  totalPromptTokens: number;
  totalMissTokens: number;
  prevPromptTokens: number;
};

function createEmptyState(): CacheMetrics {
  return {
    current: null,
    totalCacheReadTokens: 0,
    totalPromptTokens: 0,
    totalMissTokens: 0,
    prevPromptTokens: 0,
  };
}

// ──── 工具函数 ────────────────────────────────────────────────

/** 紧凑数字格式化：999 → "999", 1234 → "1.2k", 1234567 → "1.2M" */
function fmtCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
```

### Success Criteria

#### Automated Verification

- [ ] 确认 `CacheHitRateConfig` 不再包含 `recentN` 字段
- [ ] 确认 `CacheMetrics` 包含 `totalMissTokens` 和 `prevPromptTokens`，不包含 `recentSamples`
- [ ] 确认 `createEmptyState()` 返回 `totalMissTokens: 0` 和 `prevPromptTokens: 0`
- [ ] 确认 `loadConfig()` 不再校验 `recentN`，能正确解析不含 `recentN` 的配置文件
- [ ] 确认 `loadConfig()` 拒绝含 `recentN` 的旧配置（返回 `null`）
- [ ] 确认 `fmtCompact(999)` → `"999"`，`fmtCompact(1234)` → `"1.2k"`，`fmtCompact(1234567)` → `"1.2M"`

#### Manual Verification

- [ ] 不含 `recentN` 的 `cnife-cache-hit-rate.json` 能被 `loadConfig()` 正确加载

## Phase 2: buildState() 全量重建

### Overview

重写 `buildState()`：移除 `recentN` 参数和 `recentSamples` 滑动窗口逻辑，新增 miss 累计（逐对比较相邻样本）和 `prevPromptTokens` 追踪。保持 `model_change` / `compaction` 重置语义。Depends on: Phase 1。

### Changes Required

#### 1. packages/cache-hit-rate/extensions/cache-hit-rate.ts:178-215

**File**: `packages/cache-hit-rate/extensions/cache-hit-rate.ts`
**Changes**: MODIFY — 重写 `buildState()`，移除 `recentN` 参数和滑动窗口，新增 miss 累计

```typescript
/** 单次遍历 getBranch()，遇 model_change/compaction entry 重置累计状态。相邻样本逐对比较计算 miss。 */
function buildState(ctx: ExtensionContext): CacheMetrics {
  let totalCacheReadTokens = 0;
  let totalPromptTokens = 0;
  let totalMissTokens = 0;
  let prevPromptTokens = 0;
  let current: Sample | null = null;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "model_change" || entry.type === "compaction") {
      totalCacheReadTokens = 0;
      totalPromptTokens = 0;
      totalMissTokens = 0;
      prevPromptTokens = 0;
      current = null;
      continue;
    }

    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }

    const sample = getUsageSample(entry.message as AssistantMessage);
    if (!sample) continue;

    // miss = 上次请求的非 output token 中，本次未命中缓存的部分
    const miss = Math.max(0, prevPromptTokens - sample.cacheRead);
    totalMissTokens += miss;

    prevPromptTokens = sample.promptTokens;
    totalCacheReadTokens += sample.cacheRead;
    totalPromptTokens += sample.promptTokens;
    current = sample;
  }

  return {
    current,
    totalCacheReadTokens,
    totalPromptTokens,
    totalMissTokens,
    prevPromptTokens,
  };
}
```

### Success Criteria

#### Automated Verification

- [ ] 确认 `buildState()` 签名改为 `(ctx: ExtensionContext): CacheMetrics`（无 `recentN` 参数）
- [ ] 确认返回值包含 `totalMissTokens` 和 `prevPromptTokens`
- [ ] 确认 `model_change` / `compaction` 重置后 `totalMissTokens = 0` 和 `prevPromptTokens = 0`
- [ ] 确认第一个有效样本 miss = 0（`prevPromptTokens` 初始为 0）
- [ ] 确认相邻样本 miss 计算顺序正确：先计算 miss（用旧 `prevPromptTokens`），再更新 `prevPromptTokens`
- [ ] 确认返回值中 `prevPromptTokens` 等于最后一个有效样本的 `promptTokens`

#### Manual Verification

- [ ] 遍历逻辑正确性：在含有 `model_change` 的 session 中，重置后的第一个样本 miss = 0

## Phase 3: formatStatus() Footer 格式化

### Overview

删除 `calcWeightedPercent()` 函数，重写 `formatStatus()`：新增 R 公式计算（`totalInputTokens = totalPromptTokens - totalCacheReadTokens`），新增 M 显示（`fmtCompact()`，不着色），移除 R10 显示。更新空状态文本。Depends on: Phase 1。

### Changes Required

#### 1. packages/cache-hit-rate/extensions/cache-hit-rate.ts:167-175

**File**: `packages/cache-hit-rate/extensions/cache-hit-rate.ts`
**Changes**: MODIFY — 删除 `calcWeightedPercent()` 函数

删除以下整段代码：

```typescript
function calcWeightedPercent(samples: Sample[]): number | null {
  let totalCacheRead = 0;
  let totalPrompt = 0;
  for (const s of samples) {
    totalCacheRead += s.cacheRead;
    totalPrompt += s.promptTokens;
  }
  if (totalPrompt <= 0) return null;
  return (totalCacheRead / totalPrompt) * 100;
}
```

#### 2. packages/cache-hit-rate/extensions/cache-hit-rate.ts:261-299

**File**: `packages/cache-hit-rate/extensions/cache-hit-rate.ts`
**Changes**: MODIFY — 重写 `formatStatus()`，新增 R 公式和 M 显示，移除 R10

```typescript
function formatStatus(
  ctx: ExtensionContext,
  state: CacheMetrics,
  colorRules: ColorRule[],
): string {
  if (state.totalPromptTokens <= 0) {
    const empty = "Cache C:--.-- T:--.-- R:--.-- M:--";
    return ctx.ui.theme.fg("dim", empty);
  }

  const cPercent = calcPercent(
    state.current?.cacheRead ?? 0,
    state.current?.promptTokens ?? 0,
  );
  const tPercent = calcPercent(
    state.totalCacheReadTokens,
    state.totalPromptTokens,
  );

  // R = (1 − totalMissTokens / totalInputTokens) × 100
  // totalInputTokens = totalPromptTokens − totalCacheReadTokens
  const totalInput = state.totalPromptTokens - state.totalCacheReadTokens;
  const rPercent =
    totalInput > 0
      ? Math.max(0, (1 - state.totalMissTokens / totalInput) * 100)
      : null;

  const cText = applyColor(
    ctx,
    `C:${fmtPercent(cPercent)}`,
    cPercent ?? 0,
    colorRules,
  );
  const tText = applyColor(
    ctx,
    `T:${fmtPercent(tPercent)}`,
    tPercent ?? 0,
    colorRules,
  );
  const rText = applyColor(
    ctx,
    `R:${fmtPercent(rPercent)}`,
    rPercent ?? 0,
    colorRules,
  );
  const mText = `M:${fmtCompact(state.totalMissTokens)}`;

  return `Cache ${cText} ${tText} ${rText} ${mText}`;
}
```

### Success Criteria

#### Automated Verification

- [ ] 确认 `calcWeightedPercent()` 函数已删除，无其他调用者
- [ ] 确认空状态格式为 `Cache C:--.-- T:--.-- R:--.-- M:--`
- [ ] 确认 R 公式使用 `totalInput = totalPromptTokens − totalCacheReadTokens`，当 `totalInput <= 0` 时返回 `null` → `--.--`
- [ ] 确认 R 公式有 `Math.max(0, ...)` 守卫，不会产生负值
- [ ] 确认 M 使用 `fmtCompact(state.totalMissTokens)` 显示，不着色
- [ ] 确认 C/T/R 复用现有 `applyColor()` 着色（C/T 使用各自百分比，R 使用 R 公式百分比）

#### Manual Verification

- [ ] 已知数据验证：totalMiss=500, totalPrompt=5300, totalCacheRead=3000 → totalInput=2300 → R≈78.26

## Phase 4: 事件入口与 message_end + README 更新

### Overview

更新入口函数（移除 `recentN` 解构和传参），重写 `message_end` handler（移除 `recentSamples` 操作，新增 miss 计算和 `prevPromptTokens` 更新），更新 README.md 反映新指标。类型检查等基线验证在此阶段执行。Depends on: Phase 1, Phase 2, Phase 3。

### Changes Required

#### 1. packages/cache-hit-rate/extensions/cache-hit-rate.ts:314-369

**File**: `packages/cache-hit-rate/extensions/cache-hit-rate.ts`
**Changes**: MODIFY — 更新入口函数和 `message_end` handler

```typescript
// ──── 入口 ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const config = loadConfig();

  if (!config) {
    pi.on("session_start", (_event, ctx) => {
      ctx.ui.setStatus(
        STATUS_KEY,
        ctx.ui.theme.fg("error", "cache config error"),
      );
    });
    return;
  }

  const { colorRules } = config;
  const state = createEmptyState();

  pi.on("session_start", (_event, ctx) => {
    const fresh = buildState(ctx);
    Object.assign(state, fresh);
    publishCacheHitRate(ctx, state, colorRules);
  });

  pi.on("session_tree", (_event, ctx) => {
    const fresh = buildState(ctx);
    Object.assign(state, fresh);
    publishCacheHitRate(ctx, state, colorRules);
  });

  pi.on("session_compact", (_event, ctx) => {
    const fresh = buildState(ctx);
    Object.assign(state, fresh);
    publishCacheHitRate(ctx, state, colorRules);
  });

  pi.on("model_select", (_event, ctx) => {
    const fresh = buildState(ctx);
    Object.assign(state, fresh);
    publishCacheHitRate(ctx, state, colorRules);
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const sample = getUsageSample(event.message as AssistantMessage);
    if (!sample) return;

    // miss = max(0, prevPromptTokens - current.cacheRead)
    const miss = Math.max(0, state.prevPromptTokens - sample.cacheRead);
    state.totalMissTokens += miss;

    state.prevPromptTokens = sample.promptTokens;
    state.current = sample;
    state.totalCacheReadTokens += sample.cacheRead;
    state.totalPromptTokens += sample.promptTokens;

    publishCacheHitRate(ctx, state, colorRules);
  });
}
```

#### 2. packages/cache-hit-rate/README.md

**File**: `packages/cache-hit-rate/README.md`
**Changes**: MODIFY — 全面更新文档以反映新指标

```markdown
# @cnife/pi-cache-hit-rate

在 pi 的 footer 状态行中显示当前会话的**缓存命中率**和**缓存失效**指标。

## 功能

- **Current (C)**：最新一条 assistant message 的缓存命中率，反映瞬时缓存状态
- **Total (T)**：当前分支全部 assistant message 的累计加权命中率，反映长期基准
- **Real Hit Rate (R)**：有效缓存命中率，排除缓存写入带来的虚高，`R = (1 − Miss / non-cache-input) × 100`
- **Miss (M)**：累计缓存失效 token 数量，反映因缓存未命中导致的额外输入开销

### Footer 格式

```text
Cache C:85.50 T:92.10 R:96.30 M:1.2k
```

- 无数据时显示 `Cache C:--.-- T:--.-- R:--.-- M:--`
- C/T/R 依据颜色规则着色：绿（优）、黄（一般）、红（差）
- M 使用紧凑格式（k/M），不着色

### 颜色规则

通过配置文件 `~/.pi/agent/cnife-cache-hit-rate.json` 自定义颜色阈值，默认配置：

```json
{
  "colorRules": [
    { "low": 0,  "high": 75,  "color": "error" },
    { "low": 75, "high": 85,  "color": "warning" },
    { "low": 85, "high": 95,  "color": "default" },
    { "low": 95, "high": 100, "color": "success" }
  ]
}
```

- `color` 可选值：`error`（红）、`warning`（黄）、`success`（绿）、`default`（默认前景色）
- 范围 `[low, high)` 左闭右开，最后一条 `<high> ≤ 100` 时为闭区间以覆盖 100%
- 规则必须完整覆盖 `[0, 100]`，无重叠、无空缺
- 修改配置后需重启 pi 生效

配置路径为 `<agent-dir>/cnife-cache-hit-rate.json`，`<agent-dir>` 由 `PI_CODING_AGENT_DIR` 环境变量决定，默认为 `~/.pi/agent`。

### 事件处理

- **切换模型 / Compaction / 树导航**：清空所有累计指标，基于当前分支位置重建
- 每次 assistant message 结束时增量更新四项指标

### 指标说明

| 指标 | 含义 | 计算公式 | 备注 |
|------|------|----------|------|
| C | 当前消息缓存命中率 | cacheRead / promptTokens | 瞬时值 |
| T | 累计缓存命中率 | ΣcacheRead / ΣpromptTokens | 长期基准 |
| R | 有效缓存命中率 | (1 − ΣMiss / (ΣpromptTokens − ΣcacheRead)) × 100 | 排除缓存写入干扰 |
| M | 累计失效 token | Σmax(0, prevPromptTokens − cacheRead) | token 绝对值 |

Miss 通过对比相邻请求计算：上次请求的 `input + cacheRead + cacheWrite` 减去本次的 `cacheRead`（正值部分）。模型切换或 compaction 后归零。

## 安装

```bash
pi install npm:@cnife/pi-cache-hit-rate
```

## 使用

安装后自动生效，无需额外命令。

## 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| Footer 显示 `cache config error` | `cnife-cache-hit-rate.json` JSON 非法或 colorRules 不满足约束 | 删除配置文件让插件自动重建，或按格式修正 |
| Footer 显示 `--.--` | 当前会话还没有有效的 assistant message | 发送一条消息后会自动更新 |

```text

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript 编译通过：`npm run check`（在 monorepo 根目录执行，确认 `packages/cache-hit-rate` 无类型错误）
- [ ] 确认所有 `buildState()` 调用已移除 `recentN` 参数
- [ ] 确认入口函数不再解构 `recentN`
- [ ] 确认 `message_end` handler 不再引用 `recentSamples`
- [ ] 确认 `message_end` 的 miss 计算使用 `state.prevPromptTokens` 作为基线

#### Manual Verification:
- [ ] 完整场景 1（正常会话）：触发若干条消息 → footer 显示 C/T/R/M 四个指标，数值合理
- [ ] 完整场景 2（模型切换）：切换模型 → 所有指标归零，重新累计
- [ ] 完整场景 3（compaction）：触发 compaction → 所有指标归零，重新累计
- [ ] 完整场景 4（空会话）：新会话无数据 → 显示 `Cache C:--.-- T:--.-- R:--.-- M:--`
- [ ] 完整场景 5（配置错误）：配置文件含 `recentN` → 显示 "cache config error"
- [ ] 完整场景 6（配置缺失）：删除配置文件后启动插件 → 自动创建默认配置（不含 `recentN`）
- [ ] 完整场景 7（树导航）：切换分支 → 指标基于当前分支位置重建
- [ ] 确认 README.md 渲染正确，M 指标说明清晰

## Ordering Constraints

- Phase 1（类型与工具函数）→ Phase 2（buildState）: Phase 2 依赖 Phase 1 的类型定义
- Phase 1（类型与工具函数）→ Phase 3（formatStatus）: Phase 3 依赖 Phase 1 的类型定义和 `fmtCompact()`
- Phase 1, 2, 3 → Phase 4（入口 + message_end + README）: Phase 4 依赖前面所有变更
- Phase 2 和 Phase 3 可并行修改（操作不同函数），但由于是单文件 sequential diff，按顺序应用更安全
- 类型检查（`npm run check`）只有 Phase 4 应用后可通过

## Verification Notes

### 风险
1. **`prevPromptTokens` 初始值**：`buildState()` 重置后 `prevPromptTokens = 0`，第一个样本 miss = 0 — 确保不误报大额 miss
2. **消息过滤一致性**：`buildState()` 和 `message_end` 使用相同的 `getUsageSample()` 过滤逻辑 — 确保双路径等价
3. **`calcWeightedPercent()` 删除完整性**：确保无残留调用 — 已在 Phase 3 代码中验证
4. **配置向后兼容**：含 `recentN` 的旧配置文件将被新 `loadConfig()` 拒绝 — 用户需更新配置
5. **R 公式零除**：`totalInput = totalPromptTokens - totalCacheReadTokens` 可能为 0 — 已添加 `totalInput > 0` 守卫

### 验证命令
- 类型检查：`cd /home/cnife/code/pi-extensions && npm run check`
- 文件内容检查：`rg "recentN" packages/cache-hit-rate/` 应无匹配（README 已更新）
- 文件内容检查：`rg "recentSamples" packages/cache-hit-rate/` 应无匹配
- 文件内容检查：`rg "calcWeightedPercent" packages/cache-hit-rate/` 应无匹配

## Performance Considerations

- `buildState()` 维持 O(n) 单次遍历，新增 miss 计算是 O(1) 每样本
- `message_end` 移除 `recentSamples.push/shift`（O(1) 变 无操作），新增 miss 计算 O(1) — 整体性能不变或略优
- 无新增内存分配（`recentSamples` 数组已移除）


## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source   | plan-loc          | codebase-loc                | severity   | dimension             | finding   | recommendation         | resolution         |
| -------- | ----------------- | --------------------------- | ---------- | --------------------- | --------- | ---------------------- | ------------------ |
| code     | Phase 1 §4        | cache-hit-rate.ts:131-136   | concern    | actionability         | Code fence includes unchanged `type Sample` and section comment beyond stated range (137-151); literal apply would duplicate definitions | Remove unchanged content; keep only modified/new lines | applied: removed `type Sample` and section comment from code fence |
| code     | Phase 3 §2        | <n/a>                       | concern    | code-quality          | R formula can produce negative values when `totalMissTokens > totalInput` | Add `Math.max(0, ...)` guard | applied: added `Math.max(0, ...)` to R calculation |
| coverage | <n/a>             | <n/a>                       | -          | verification-coverage | All 9 Verification Notes entries covered | <n/a>                | all cleared          |


## Pattern References

- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:178-215` — `buildState()` 现有遍历 + 重置模式（扩展为包含 miss 累计）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:355-369` — `message_end` 增量更新模式（替换滑动窗口为 miss 计算）
- `node_modules/@earendil-works/pi-coding-agent/examples/extensions/custom-footer.ts:42` — inline `fmt` 紧凑格式模式（`fmtCompact()` 扩写为支持 k/M）
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts:144-151` — `createEmptyState()` 工厂函数（扩展新增字段）

## Developer Context

### Step 4 Checkpoint

**Design confirmation** (2026-06-03T22:27:21+0800): 设计方案通过。用户补充：package.json 和 README 也需要更新。
- Decision: package.json 保持描述不变（"Show cumulative session cache hit rate in pi footer" 仍准确），版本号 release 时处理
- Decision: README.md 在 Phase 4 中全面更新
- Decision: 切片分解调整为 4 个阶段，README 加入 Phase 4

### Step 5 Decomposition confirmed
4 切片：Phase 1 类型系统与工具函数 → Phase 2 buildState() → Phase 3 formatStatus() → Phase 4 入口 + message_end + README

## Plan History

- Phase 1: 类型系统与工具函数 — approved as generated
- Phase 2: buildState() 全量重建 — approved as generated
- Phase 3: formatStatus() Footer 格式化 — approved as generated
- Phase 4: 事件入口与 message_end + README — approved as generated

## References

- `.rpiv/artifacts/research/2026-06-03_22-09-51_cache-miss-token-count.md` — 主要调研产物
- `.rpiv/artifacts/discover/2026-06-03_21-46-17_cache-miss-token-count.md` — FRD
- `.rpiv/artifacts/research/2026-06-01_21-46-35_pi-extension-api-patterns.md` — pi 扩展 API 模式
- `packages/cache-hit-rate/extensions/cache-hit-rate.ts` — 变更目标文件
- `packages/cache-hit-rate/README.md` — 需更新的文档
