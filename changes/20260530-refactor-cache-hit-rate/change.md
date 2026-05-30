# 变更 v1：grill 细化

> 使用 grill 对照 CONTEXT.md 逐条追问，澄清 plan.md 中的模糊表述。

## 澄清结论

| # | 问题 | 结论 |
|---|------|------|
| 1 | 优化方向 | 验证核心公式正确性，重构指标设计为多时间尺度系统 |
| 2 | 核心公式验证 | `cacheRead / (input + cacheRead + cacheWrite)` 在所有 pi-ai provider 下正确 |
| 3 | 指标设计 | 多时间尺度指标：Current（单条）、Recent N（加权平均）、Total（累计），类似 K 线均线 |
| 4 | Footer 格式 | `Cache C:12.34 R10:56.78 T:99.99`，数据不足显示 `--.--%`，Recent 不足 N 条时显示实际数量 |
| 5 | Recent 加权方式 | 按 prompt token 数量加权 |
| 6 | 颜色规则 | 三指标统一用配置文件定义的 colorRules，支持语义色名，默认阈值保留 |
| 7 | 样本有效性 | 取消 MIN_TREND_PROMPT_TOKENS 阈值，全部数据纳入计算 |
| 8 | 配置文件 | `~/.pi/agent/cnife-cache-hit-rate.json`，不存在时自动创建，仅启动时读取 |
| 9 | 模型/compact/tree 切换 | 清空 Recent N 样本，Current 自然覆盖，Total 保留 |
| 10 | session_tree 处理 | 与 compact 一致——清空 Recent N |

---

## 变更 v2：plan 方案

> 方案已写入 plan.md。

### 方案摘要

- **多指标**：Current / Recent N / Total，替代旧的累计 + delta 双指标
- **配置**：独立 JSON 文件，recentN + colorRules
- **性能**：去掉 buildState() 双遍历，Total 改为增量累加
- **事件**：model_select / compact / tree 清空 Recent，Total 永不重置

---

## 变更 v3：check 审查修正

> 使用 check 技能审查 plan.md v2，发现内部矛盾和设计缺陷，经讨论后修正。

### 修正项

| # | 修正 | v2 旧设计 | v3 终稿 |
|---|------|----------|--------|
| 1 | Total 数据源 | getEntries() 全会话 | getBranch() 仅当前分支 |
| 2 | Current 事件处理 | 自然覆盖（保留旧值） | model_select/compact/tree 直接清空 |
| 3 | Total 事件处理 | 保留不重置 | 基于当前位置重算 |
| 4 | 初始化遍历 | 双遍历 | 单次 getBranch()，遇 model_change/compaction 清空并继续 |
| 5 | 0 条样本显示 | 未明确定义 | 三个指标均显示 --.--%，Recent 后缀 0 |
| 6 | 颜色边界 100% | 未处理 | 最后一条 high ≤ 100 用 ≤ 判断 |
| 7 | 配置失败处理 | 未定义 | 显示 cache config error |
| 8 | colorRules 验证 | 未定义 | 覆盖 [0, 100]、无重叠、无空缺 |

---

## 变更 v4：任务拆解

### 产出文件

tasks.md, tasks/T01-config-module.md, tasks/T02-core-state.md, tasks/T03-footer-format.md, tasks/T04-event-handlers.md, tasks/T05-update-readme.md

### 变更概述

将 plan.md 拆解为 5 个可独立验证的子任务，按 5 个串行层排列（单文件重构，水平分层）。

### 任务摘要

| ID | 子任务 | 涉及文件 |
|----|--------|---------|
| T1 | 配置文件加载与验证 | cache-hit-rate.ts |
| T2 | 核心状态与采样逻辑 | cache-hit-rate.ts |
| T3 | Footer 格式化与颜色 | cache-hit-rate.ts |
| T4 | 事件处理重写 | cache-hit-rate.ts |
| T5 | 更新 README 文档 | README.md |

### 并行分层

| 层 | 包含任务 | 依赖 |
|----|---------|------|
| 1 | T1 | 无 |
| 2 | T2 | T1 |
| 3 | T3 | T1, T2 |
| 4 | T4 | T2, T3 |
| 5 | T5 | T4 |

---

## 变更 v5：任务拆解审阅

> 使用 check 技能审查 task 文件，对照 plan.md v3 终稿检查遗漏和错误。

### 发现项

| # | 严重度 | 涉及任务 | 问题 |
|---|--------|---------|------|
| 1 | 🔴 阻塞 | T01 | 配置路径硬编码 `~/.pi/agent/`，应用 `getAgentDir()` 以支持 `PI_CODING_AGENT_DIR` |
| 2 | 🔴 阻塞 | T02 | `CacheMetrics` 类型 `recentN` 字段为单样本，应为 `Sample[]` 数组 |
| 3 | 🟡 遗漏 | T01 | colorRules 验证逻辑需明确最后一条规则 high ≤ 100 为闭区间（与 T03 着色一致） |
| 4 | 🟡 遗漏 | T01+T04 | 未指定 `loadConfig()` 调用时机，应在模块顶层加载为闭包变量 |
| 5 | 🟡 歧义 | T04 | handler 描述「清空 Recent N 和 Current」多余，实际 `buildState()` 已产出正确状态 |
| 6 | 🟡 遗漏 | T04/T05 | 未提及 `package.json` version 从 `0.1.0` bump 到 `0.2.0`（breaking change） |
| 7 | 🟡 措辞 | T04 | 验证描述「Total 不变」与 plan「基于当前位置重算」不一致 |

### 执行

- T01：配置路径改为 `getAgentDir()`，补充验证规则（最后一条闭区间）、`loadConfig()` 调用时机
- T02：`CacheMetrics.recentSamples` 类型从单样本改为 `Sample[]`，补充 `model_change/compaction` 重置描述
- T04：handler 去重（统一调用 `buildState()`），追加 `package.json` version bump 到 `0.2.0`
- T03、T05：无变更

---

## 变更 v6：代码实现

> 按 T01~T05 顺序实现全部代码，合并为一次重写（单文件耦合，不可分批）。

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/cache-hit-rate/extensions/cache-hit-rate.ts` | 189 行 → 267 行，完全重写 |
| `packages/cache-hit-rate/package.json` | version 0.1.0 → 0.2.0 |
| `packages/cache-hit-rate/README.md` | 双指标 → 多指标文档 |

### 实现要点

- **配置**：`getAgentDir()` 定位路径、`saveDefaultConfig()` 自动创建、`validateColorRules()` 覆盖校验、加载失败 early return 显示 `cache config error`
- **状态**：`CacheMetrics`（current / recentSamples[] / 累计）、`buildState()` 单次遍历 getBranch()，遇 model_change/compaction entry 重置累计和样本
- **格式化**：`Cache C:12.34 R10:56.78 T:99.99`、`applyColor()` 最后一条规则 ≤ 判断保证 100% 着色
- **事件**：5 个 handler 均调用 `buildState()`，message_end 增量更新
- **测试**：Python 独立验证 validateColorRules / calcWeightedPercent / applyColor 全部通过
- **编译**：TypeScript --noEmit 无错误

### 任务状态

| ID | 子任务 | 状态 |
|----|--------|------|
| T1 | 配置文件加载与验证 | ✅ 已完成 |
| T2 | 核心状态与采样逻辑 | ✅ 已完成 |
| T3 | Footer 格式化与颜色 | ✅ 已完成 |
| T4 | 事件处理重写 | ✅ 已完成 |
| T5 | 更新 README 文档 | ✅ 已完成 |

---

## 变更 v7：代码审查

> 使用 check 技能审查实现代码（commit `27f9ee9`），对照 plan.md v3 终稿。

### 结论

- 硬性阻塞：0
- 逻辑错误：0
- plan 偏离：0

### 发现项

| # | 严重度 | 涉及文件 | 问题 |
|---|--------|---------|------|
| 1 | 📝 措辞 | 8 个文件 | 「多指标」说法不准确，Current 不是均线，只有 Recent N 是——应改为「多指标」或类似表述 |
| 2 | 📝 遗漏 | README.md | 配置路径未说明受 `PI_CODING_AGENT_DIR` 环境变量影响 |
| 3 | 🔧 改善 | cache-hit-rate.ts | `validateColorRules` 浮点比较用 0.001 epsilon，应改为严格比较或加注释 |
| 4 | 🔧 改善 | cache-hit-rate.ts | `applyColor` 无匹配规则时的 fallback 缺少注释 |

### 执行

4 项全部修正：

- #1：8 个文件「三均线」→「多指标」/「多时间尺度」
- #2：README.md 配置文件章节新增 `PI_CODING_AGENT_DIR` 路径说明
- #3：`validateColorRules` 浮点比较添加 epsilon 注释
- #4：`applyColor` fallback 添加防御性注释

---

## 变更 v8：端到端验证

> 使用 `pi -ne -ns -e` 精确加载被测扩展，tmux 交互式测试 7 个场景。

### 测试环境

```bash
pi --no-extensions --no-skills -e packages/cache-hit-rate/extensions/cache-hit-rate.ts --models deepseek/deepseek-v4-flash,deepseek/deepseek-v4-pro --no-session
```

### 测试结果

| # | 场景 | Footer 输出 | 结果 |
|---|------|-----------|------|
| 1 | 0 条样本 | `Cache C:--.-- R0:--.-- T:--.--` | ✅ |
| 2 | 单轮对话 | `Cache C:0.00 R1:0.00 T:0.00` | ✅ |
| 3 | 多轮对话（加权平均） | `Cache C:95.85 R2:48.05 T:48.05` | ✅ |
| 4 | 模型切换（瞬时） | `Cache C:--.-- R0:--.-- T:--.--` | ✅ |
| 5 | 模型切换后发消息 | `Cache C:95.46 R1:95.46 T:95.46` | ✅ |
| 6 | 非法 JSON 配置 | `cache config error` | ✅ |
| 7 | 配置删除后重启 | 自动创建默认配置 | ✅ |
