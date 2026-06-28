# @cnife/pi-cache-hit-rate

在 pi 的 footer 状态行中显示当前会话的**缓存命中率**和**缓存失效**指标。

## 功能

- **Current (C)**：最新一条 assistant message 的缓存命中率，反映瞬时缓存状态
- **Total (T)**：当前分支全部 assistant message 的累计加权命中率，反映长期基准
- **Real Hit Rate (R)**：有效缓存命中率，排除缓存写入带来的虚高，`R = (1 − Miss / non-cache-input) × 100`
- **Miss (M)**：累计缓存失效 token 数量，反映因缓存未命中导致的额外输入开销

### Footer 格式

```text
Cache C85.5% T92.1% R96.3% M1.2k
```

- 无数据时显示 `Cache C--.-% T--.-% R--.-% M--`
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
| M | 累计失效 token | Σmax(0, baselinePrompt − cacheRead) | token 绝对值 |

Miss 以**用户消息边界为轮**，以上一轮最后一条 assistant message 的 `promptTokens` 作为本轮缓存基线（`baselinePrompt`）。同轮内连续 asst msg 共享同一基线，避免 cacheWrite 虚增 miss。模型切换或 compaction 后归零。

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
