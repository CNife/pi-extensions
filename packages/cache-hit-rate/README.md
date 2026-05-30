# @cnife/pi-cache-hit-rate

在 pi 的 footer 状态行中显示三个时间尺度的**缓存命中率**，类似 K 线均线系统。

## 功能

- **Current (C)**：最新一条 assistant message 的缓存命中率，反映瞬时缓存状态
- **Recent N (R{N})**：最近 N 条 assistant message 按 prompt token 加权的平均命中率，反映短期趋势
- **Total (T)**：当前分支全部 assistant message 的累计加权命中率，反映长期基准

### Footer 格式

```text
Cache C:85.50 R10:78.30 T:92.10
```

- 无数据时显示 `Cache C:--.-- R0:--.-- T:--.--`
- Recent 实际样本数不足 N 条时，显示实际数量（如 `R3:56.78`）

### 颜色规则

通过配置文件 `~/.pi/agent/cnife-cache-hit-rate.json` 自定义颜色阈值，默认配置：

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

- `color` 可选值：`error`（红）、`warning`（黄）、`success`（绿）、`default`（默认前景色）
- 范围 `[low, high)` 左闭右开，最后一条 `<high> ≤ 100` 时为闭区间以覆盖 100%
- 规则必须完整覆盖 `[0, 100]`，无重叠、无空缺
- 修改配置后需重启 pi 生效

配置路径为 `<agent-dir>/cnife-cache-hit-rate.json`，`<agent-dir>` 由 `PI_CODING_AGENT_DIR` 环境变量决定，默认为 `~/.pi/agent`。

### 事件处理

- **切换模型 / Compaction / 树导航**：清空 Current 和 Recent N，Total 基于当前分支位置重建
- 每次 assistant message 结束时增量更新三项指标

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
| Footer 显示 `--.--%` | 当前会话还没有有效的 assistant message | 发送一条消息后会自动更新 |
