# compact-threshold (personal)

按当前模型的窗口实时算上下文压缩阈值，跨过阈值时触发一次 pi 原生压缩。替代「给每个模型手写 `compaction.reserveTokens` 常量」的做法。

## 阈值

```text
阈值 = min(300K 已用 token, 85% × contextWindow)
```

| 窗口 | 85% | 实际阈值 |
| --- | --- | --- |
| 1,000,000 | 850K | **300K**（30%） |
| 512,000 | 435K | **300K**（59%） |
| 262,144 | 223K | 223K（85%） |
| 32,768 | 28K | 28K（85%） |

常量和实现在 [`extensions/threshold.ts`](extensions/threshold.ts) 的 `DEFAULT_THRESHOLD_OPTIONS`。想改成「纯 85%」把 `maxUsedTokens` 调大即可；要改行为就改那两个数，没有配置文件。

## 行为

- 在 `turn_end` 读 `ctx.getContextUsage()`（工具结果已入上下文，等价于 pi 内建的检查点）；
- 超过阈值就触发**一次**压缩，之后带抑制标记：只要还高于阈值就不再压（防压缩循环），降到阈值以下才解除；
- 首次采样就超标（resume 一个已经很长的会话）也直接触发，不要求先看到「从下往上跨过」的过程；
- 触发后调 `ctx.compact()`，用 pi 自己的摘要流程，不接管摘要内容；
- 会话切换（`session_start`）后清掉抑制状态。

内建自动压缩**保持开启**：它在「窗口 - 16K」（约 98%）触发，晚于本扩展的阈值，因此退化成兜底，provider 溢出恢复也仍由 pi 自己处理。所以本扩展不需要改 `settings.json` 的任何 `compaction.*` 值。

## 命令

```text
/compact-threshold   显示已用 / 窗口 / 阈值
```

## 已知边界

- 单条消息本身就顶爆阈值（例如一次粘贴 400K 文本）时，要等到该轮 `turn_end` 才压缩，期间那一次请求可能已经超窗 → 由 pi 内建的溢出恢复兜底；
- `contextWindow` 缺失的模型（模型目录里为 `null`）不参与判断。

## 本地测试

```bash
pi --no-extensions -e personal/compact-threshold
```
