# @cnife/pi-cache-hit-rate

在 pi 的 footer 状态行中显示**当前会话的累计缓存命中率**。

## 功能

- 显示形如 `Cached 99.99%` 的累计命中率文案
- 统计口径为 `cacheRead / (input + cacheRead + cacheWrite)`
- 当最近趋势样本足够时，追加短期趋势：
  - 采样单位：`assistant message`
  - 有效样本门槛：单条 `promptTokens >= 3000`
  - 窗口：最近 5 条有效样本 vs 再前 5 条有效样本
  - 显示格式：`Cached 99.99% | Recent 88.88% | -12.34pt`
- 颜色规则：
  - 只有累计命中率时：`<75%` 红，`75%-85%` 黄，`85%-95%` 默认前景色，`>=95%` 绿
  - 显示趋势时：`delta > 5pt` 绿，`-5pt <= delta <= 5pt` 默认前景色，`-15pt < delta < -5pt` 黄，`delta <= -15pt` 红

## 安装

```bash
pi install npm:@cnife/pi-cache-hit-rate
```

## 使用

安装后自动生效，无需额外命令。

如果当前会话还没有可用的 assistant usage 数据，会先显示 `Cached --.--%`。
如果有效趋势样本还不足 10 条，则只显示累计命中率，不显示 `Recent` 和 `delta`。
