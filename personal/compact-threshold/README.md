# compact-threshold (personal)

按当前模型的窗口实时算上下文压缩阈值，超标时触发一次 pi 原生压缩。替代「给每个模型手写 `compaction.reserveTokens` 常量」。

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

常量在 [`extensions/threshold.ts`](extensions/threshold.ts)（`MAX_USED_TOKENS` / `TRIGGER_PERCENT`）。想改成「纯 85%」把 `MAX_USED_TOKENS` 调大即可 —— 这是改源码，本包刻意没有配置文件。

pi 只有 `compaction.reserveTokens` 与 `compaction.modelOverrides` 两个入口，两者都只能写死 **per-model 常量**，没有「按窗口自动算」的能力；换模型或换窗口就得手工重算，所以阈值放到扩展里实时算。

## 触发点：`agent_settled`

**不是 `turn_end`，也不是 `agent_end`。** `ctx.compact()` 走 pi 的 manual 入口，第一件事就是 `await abort()`，接口文档写明：

> Manually compact the session context… **Aborts the current agent operation first. Manual compaction never retries or continues the interrupted agent turn.**

- `turn_end` 是 run 中途 → 压缩会把正在跑的 agent 循环打断，后续 turn 与 steering 全丢；
- `agent_end` 也不行：此时 `_isAgentRunActive` 仍为 `true`（要等 `_emitAgentSettled` 才置 false），abort 请求会把排队 follow-up、自动重试、溢出/长度恢复一并取消；
- 只有 `agent_settled`（pi 已无剩余自动工作）里 run 已标记非活跃，abort 才是空操作。

## 状态机

- 超标 → 压**一次**，转入抑制；
- 抑制期间不再压（压缩刚完成时占用未知，防每轮重压）；
- 占用降回阈值以下 → 解除抑制、清零尝试次数，下次再超就再压；
- 压缩失败/被取消 → 解除抑制，下个 run 收尾时再试，最多 `MAX_ATTEMPTS`（3）次，之后放弃、交回内建兜底。

## 与内建的关系

内建自动压缩`保持开启`：它在「窗口 - 16K」（约 98%）触发，晚于本扩展的阈值，因此退化成兜底；provider 溢出恢复仍归 pi 自己处理。把 `compaction.enabled` 设为 `false` 时本扩展也不接管（尊重显式关闭）。

另一条容易忽略的联动是 `compaction.keepRecentTokens`（默认 20K）：压缩的切点由它决定，所以 1M 窗口在 300K 触发后，存活上下文会被砍到「摘要 + 最近约 20K」，而**不是**保留到 300K。想留下更多现场就调大它。

## 命令

```text
/compact-threshold   显示已用 / 窗口 / 阈值
```

## 已知边界

- **resume 长会话**：`tokens` 优先取最后一条 assistant usage，恢复一个已超阈值的会话时，要等第一轮跑完（`agent_settled`）才会压，那一次请求仍按原样发出（靠内建兜底）；
- **单个超长 run**：只在 run 收尾时检查，run 中途冲过阈值不会被打断压缩，极端情况靠内建溢出恢复；
- **进程退出**：print 模式跑完即结束进程，可能来不及完成压缩（长驻的交互 / RPC 模式无此问题）；
- `contextWindow` 为 `null` 的模型不参与判断。

## 本地测试

```bash
pi --no-extensions -e personal/compact-threshold
```

包 manifest 显式登记 `./extensions/index.ts`：`extensions/` 下还有仅供 import 的 `threshold.ts`，用目录会被 pi 当扩展入口加载并报「does not export a valid factory function」。
