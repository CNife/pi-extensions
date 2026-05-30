# 变更方案

## 目标

重构 cache-hit-rate 插件，将单一累计命中率指标升级为多时间尺度指标体系，提升诊断价值。

## 背景

当前插件只有两个指标：累计命中率 + 短期趋势 delta。累计命中率随会话增长信号衰减严重，短期趋势的样本筛选阈值（MIN_TREND_PROMPT_TOKENS=3000）会丢失信息。经 grill 验证，核心公式 `cacheRead / (input + cacheRead + cacheWrite)` 在所有 pi-ai provider 下均正确。

## 最终方案

### 1. 多指标

| 指标 | 计算方式 | 说明 |
|------|---------|------|
| Current (C) | 最新一条 assistant message 的 `cacheRead / promptTokens` | 瞬时值，类似 K 线当前价 |
| Recent N (R{N}) | 最近 N 条有效样本按 prompt token 加权平均 | 短期趋势，类似 MA |
| Total (T) | 当前分支有效样本按 prompt token 加权平均 | 长期基准，类似 MA∞ |

### 2. Footer 格式

```text
Cache C:12.34 R10:56.78 T:99.99
```

- 0 条样本：三个指标均显示 `--.--%`（如 `Cache C:--.-- R0:--.-- T:--.--`）
- ≥1 条样本：三个指标同时有值，Recent 后缀数字为实际样本数（如 `R1:56.78`、`R5:88.88`）

### 3. 颜色规则

配置文件 `~/.pi/agent/cnife-cache-hit-rate.json` 中定义颜色规则数组，每条规则包含范围 `[low, high)` 和对应的 pi 主题语义色名。默认配置：

```json
{
  "recentN": 10,
  "colorRules": [
    { "low": 0,  "high": 75,  "color": "error" },
    { "low": 75, "high": 85,  "color": "warning" },
    { "low": 85, "high": 95,  "color": "default" },
    { "low": 95, "high": 100, "color": "success" }
  ]
}
```

三个指标统一使用同一套颜色规则。`"default"` 表示不应用主题色，使用 footer 默认前景色。

规则区间为 `[low, high)`，必须完整覆盖 `[0, 100]` 且无重叠、无空缺。最后一条规则的 `high ≤ 100` 时使用 `≤` 判断，确保 100.00% 命中率正确着色。默认配置已满足此约束。

如配置文件不存在，启动时自动创建并写入上述默认值。如配置文件存在但解析失败（JSON 非法、colorRules 不满足覆盖约束），显示 `cache config error` 而非静默降级，提示用户修正配置。仅启动时读取，不热加载。

### 4. 事件处理

| 事件 | Current | Recent N | Total |
|------|---------|----------|-------|
| `message_end` | 更新为最新样本 | 推入新样本，弹出旧样本 | 累加新样本 |
| `session_start` | 全量重建 | 全量重建 | 全量重建 |
| `model_select` | 清空 | 清空 | 基于当前位置重算 |
| `session_compact` | 清空 | 清空 | 基于当前位置重算 |
| `session_tree` | 清空 | 清空 | 基于当前位置重算 |

### 5. 状态管理与性能

- 去掉 `buildState()` 的双遍历，改用一次遍历 `getBranch()` 同时构建 Total 和 Recent N：从前往后扫描，遇到 `model_change` 或 `compaction` entry 时清空 Total 和 Recent N 的累积状态并继续；遍历结束后截断 Recent N 到最近 N 条。后续 `message_end` 增量更新。
- `session_tree` / `session_compact` / `model_select` 时不再做全量重建，改为遍历 `getBranch()` 从当前位置重算 Total，同时清空 Recent N 和 Current。
- 去掉 `MIN_TREND_PROMPT_TOKENS` 阈值判断，所有 `promptTokens > 0` 的样本均有效。

## 关键决策

| # | 决策 | 理由 |
|---|------|------|
| 1 | 采用多时间尺度指标而非保留旧双指标 | 累计 + delta 的诊断价值弱，多指标提供清晰的短/中/长时间尺度 |
| 2 | Recent N 按 prompt token 加权 | 大 token 样本对缓存成本影响更大，加权更准确反映成本影响 |
| 3 | model_select / compact / tree 清空 Recent | 这些事件导致缓存失效，旧样本不再具有预测价值 |
| 4 | Total 在模型切换/compact/tree 时重算 | 基于当前分支当前位置的累计反映真实缓存效率，不混入失效分支或旧模型的数据 |
| 5 | 取消 MIN_TREND_PROMPT_TOKENS 阈值 | 全部样本都有信息量，阈值会丢失小 token 消息的缓存行为 |
| 6 | 配置文件独立于 settings.json | 避免与 pi 核心配置耦合，方便独立维护 |
| 7 | 仅启动时读取配置，不热加载 | 简化实现，recentN 变化频率极低不值得增加文件监听复杂度 |

## 用语

- **多指标**：Current / Recent N / Total 三个时间尺度的缓存命中率
- **采样**：以 assistant message 为单位的缓存命中率数据点
- **加权平均**：以 prompt token 数量为权重的平均计算方式

## 假设

- 假设 pi-ai 的 `usage.input` 归一化规则（非缓存净值）在未来版本保持不变。如有变化，公式需同步更新。
- 假设 footer 空间足够显示 `Cache C:12.34 R10:56.78 T:99.99` 格式。如果终端过窄 (< 50 列)，显示可能被截断。
