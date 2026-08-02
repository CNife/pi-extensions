---
name: fabric-best-practices
description: >-
  fabric_exec 行为纠错层：fabric_exec 能跑通但行为不对时加载--结果没回到模型、
  独立调用没坍缩并行、机制用在了错误的时间尺度。只管判断与避坑；签名 / 参数形状
  报错见 fabric-exec，工作流选型见 fabric-guide。
---

# fabric_exec 判断力手册

本技能管**判断与避坑**，且只收别处没有的判断。签名 / 返回形状见 fabric-exec；工作流选型见 fabric-guide；证据门禁见 fabric-schema。不复述它们已有的内容。

## 心智模型：这是程序执行器，不是工具调用入口

fabric_exec 是一段 **TypeScript 程序的执行器**，不是“一个复杂的工具调用入口”。三条第一原理：

- **`return` 才进模型，`print`/`console.log` 只到活动面板。** 需要模型看到的数据必须 `return`；打印只是旁路，模型看不到。这是最常被违反的一条。
- **控制流属于程序，不属于模型的下一步决策。** 分支、循环、并行写在程序里，把 N 次往返压成 1 次，而非发 N 次调用让模型逐个决定。独立调用用 `Promise.all` 坍缩；有依赖的才 `await` 串行。
- **“等待”是 `await` 关键字，不是再发一次工具调用。** 等一个异步结果在程序内 `await`，零额外往返--不要回到模型再决定“现在去等它”。

用 RPC 心智（一次一件、串行决策、打印看结果）驱动 fabric_exec，是大多数行为误用的根。

## 独家判断（别处没有，只在这里）

**edit 小批量。** 单次 `edit` 控制在 3–5 个 op 内，大批量拆成多次调用。op 越多，前一个 op 改动使后续锚点失效（`E_STALE_ANCHOR`）的概率越高，整批原子拒绝。恢复优势：拒绝结果内嵌新锚点，据此重试。

**compact.request 是建议，不是立即压缩。** 它只记录意图，host 在安全边界（`agent_settled`）才真正执行；新请求替换旧的 pending。preserve 有硬上限：最多 16 项、每项 ≤2048 字符、前缀+JSON 总量 ≤16KiB，超出整条请求被结构化解码拒绝（不回退纯文本）。压缩从原始活跃分支重建，不是累积摘要--别依赖摘要里的语义，要查就 recall 原始 session。

**state.transition 成功 ≠ 认证。** transition 只记录“提出了一个 claim”，不跑任何证据，`certificationStatus` 初始是 `pending`。只有 `state.verify()` 返回 `certified:true` 才是认证。

**按时间尺度选等待的层级。** 微秒~秒 -> 程序内 `await` / `Promise.all`；秒~分 -> `agents.run`/`spawn` + `agents.wait`；事件驱动 / 跨会话 -> 持久 actor + mesh（选型见 fabric-guide，如 `/skill:fabric-swarm`、`/skill:fabric-supervisor`）。别用 spawn 级机制等一个秒级任务，也别在程序里死等一个跨会话任务。

## 外包指针

- 签名 / 返回形状 / discovery / 参数形状报错 -> **fabric-exec**
- workflow / council / fusion / rlm / schema / swarm 选型 -> **fabric-guide**
- 证据门禁与事务写 -> **fabric-schema**
