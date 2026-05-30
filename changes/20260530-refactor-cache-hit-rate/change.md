# 变更 v1：grill 细化

> 使用 grill 对照 CONTEXT.md 逐条追问，澄清 plan.md 中的模糊表述。

## 澄清结论

| # | 问题 | 结论 |
|---|------|------|
| 1 | 优化方向 | 验证核心公式正确性，重构指标设计为三均线系统 |
| 2 | 核心公式验证 | `cacheRead / (input + cacheRead + cacheWrite)` 在所有 pi-ai provider 下正确 |
| 3 | 指标设计 | 三均线：Current（单条）、Recent N（加权平均）、Total（累计），类似 K 线均线 |
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

- **三均线指标**：Current / Recent N / Total，替代旧的累计 + delta 双指标
- **配置**：独立 JSON 文件，recentN + colorRules
- **性能**：去掉 buildState() 双遍历，Total 改为增量累加
- **事件**：model_select / compact / tree 清空 Recent，Total 永不重置

---

## 变更 v3：plan 审阅修正

> 使用 check 技能审查 plan.md，发现 3 处硬性阻塞和 4 处设计缺陷，经讨论后修正。

### 修正项

| # | 问题 | 修正前 | 修正后 |
|---|------|--------|--------|
| 1 | plan 内部矛盾 | 第 5 节说 session_start 不再全量重建 Total，与事件表冲突 | 删除 `session_start /`，第 5 节仅针对 session_tree/compact/model_select |
| 2 | Total 数据源 | 用 `getEntries()` 遍历全部会话历史 | 改为 `getBranch()` 仅遍历当前分支 |
| 3 | model_select 时 Total 行为 | 保留不重置 | 改为基于当前位置重算（遍历 getBranch() 从当前点重新累计） |
| 4 | session_tree 时 Current | 自然覆盖（保留旧值） | 改为直接清空 |
| 5 | compact/tree 时 Total | 保留不重置 | 同上，基于当前位置重算 |
| 6 | 颜色规则 | 100% 命中率落在 [95, 100) 开区间外 | 明确最后一条规则 high ≤ 100 时用 ≤ 判断，保证全覆盖 |
| 7 | 配置加载失败 | 未定义降级行为 | 失败时显示 `cache config error` |
| 8 | Footer 格式 | 未区分 0 条 vs ≥1 条 | 0 条三个指标均显示 `--.--%`，≥1 条三个同时有值 |
| 9 | 初始化遍历 | 保留 buildState() 双遍历（Total 走 getEntries，Recent 走 getBranch） | 一次遍历 getBranch()，遇到 model_change/compaction entry 清空累积状态并继续 |
