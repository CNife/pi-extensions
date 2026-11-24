# 压缩阈值用扩展实时算，而不是逐模型写 reserveTokens

日期：2026-11-24；状态：已接受。

## 背景

pi 的自动压缩阈值是 `contextTokens > contextWindow - compaction.reserveTokens`，而 `reserveTokens` 与 `compaction.modelOverrides` 都只能写死整数常量，没有「按窗口比例算」的能力。想要的规则是 `min(300K 已用 token, 85% × 窗口)`；按这条规则给每个在用的模型各算一个常量，换模型、换窗口、换 provider 都要重算一遍，而且小窗口模型一旦套上为大窗口算的常量，`contextWindow - reserveTokens` 变成负数，会每轮都触发压缩。

## 决定

在 `personal/compact-threshold` 里用扩展实时算阈值：在 `agent_settled` 读 `ctx.getContextUsage()`，算出 `min(300K, 85% × 窗口)`，超标就调一次 `ctx.compact()`。

- 不改 `settings.json` 的任何 `compaction.*`：内建阈值（窗口 - 16K，约 98%）晚于本扩展，退化成兜底；provider 溢出恢复仍归 pi。
- 状态机用抑制标记 + 有界重试（`MAX_ATTEMPTS = 3`），同一次超标只压到「压下来或放弃」为止，避免压缩没压到位时每轮重压。
- `compaction.enabled: false` 时不接管。

## 考虑过的方案

- **`settings.json` 里逐模型写 `reserveTokens`**：零代码，但是把可推导的量变成需要人工同步的清单（见背景）。为 1M 家族写 700000、为 512K 写 212000 还能忍，一旦 scope 里混进小窗口模型就出现负数阈值，且没有任何地方会报错。
- **在 `turn_end` 或 `agent_end` 触发压缩**：更贴近「何时超了就何时压」，但 `ctx.compact()` 是 pi 的 manual 入口，第一件事是 `abort()`。`turn_end` 是 run 中途，会把 agent 循环打断；`agent_end` 时 `_isAgentRunActive` 仍为 true（要等 `_emitAgentSettled` 才置 false），abort 请求会取消排队 follow-up、自动重试与溢出/长度恢复。只有 `agent_settled` 里 abort 是空操作。
- **在 `agent_before_settle` 自己追加 `compaction` entry**：那是 pi 允许的 draft entry 类型，能完全避开 abort，但要自己序列化历史、自己调模型写摘要——等于重造 pi-tuck 那类零模型压缩，远超本需求。
- **等 pi 暴露可编程阈值**：不存在。`CompactionSettings` 只有常量字段。

## 后果

- 压缩点落在 run 收尾：单个超长 agentic run 中途冲过阈值不会被打断，靠内建溢出恢复兜底。
- 压缩后保留多少由 `compaction.keepRecentTokens`（默认 20K）决定，不是保留到 300K；想要更大现场得自己调它。
- resume 一个已超阈值的会话时，要等第一轮跑完才会压（`tokens` 取自最后一条 assistant usage）。
- per-model 的 `modelOverrides.*.enabled` 不可见：扩展只能读合并后的 `compaction.enabled`。
- print 模式跑完即退出进程，可能来不及完成压缩。
- 依赖 `ctx.compact()` = manual 入口（会 abort）这一 pi 内部语义；pi 若为扩展提供非中止的压缩入口，这里应改用它。
