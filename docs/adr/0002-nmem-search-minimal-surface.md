# nmem_search 保持精简工具面，不暴露后端过滤参数

## 背景

nmem 后端 `POST /memories/search` 的 `MemorySearchRequest` 支持 12 个字段（`query`/`limit`/`mode`/`include_entities`/`filter_labels`/`metadata_filters`/`unit_type`/`event_date_from`/`event_date_to`/`recorded_date_from`/`recorded_date_to`/`temporal_context`/`space_id`）。nmem CLI 也把这些暴露成 `--unit-type`/`--label`/`--time`/`--importance-min`/`--mode` 等开关。pi 插件的 `nmem_search` 是否该把这些过滤能力暴露给 LLM？另外，会话启动注入的 Context Bundle（含 working memory）是否该默认开启？

本决策基于一次实证调研：用 pi-session-query 扫了 74 个会话、125 次 `nmem_search` 调用，并对照 nmem 官方概念文档（搜索架构 / 记忆衰减 / 上下文）与后端 REST 运行时行为。

## 决定

1. `nmem_search` 只暴露 `query + limit`，不暴露其余过滤参数。
2. 不显式传 `mode`（吃后端 fast 默认 + 自动升级）。
3. Context Bundle 默认禁用（`injectContextBundle = false`）。
4. 配套：`limit` 默认 `10 -> 5`（threads 与 memories 共用）。

## 原因

nmem search 本身是一套自动调优的智能系统，插件层加手动过滤参数要么多余、要么有害：

- **六策略并行混合排序**（语义 + 全文 + 实体 + 社区 + 标签 + 图遍历），语义相关性主导。
- **时间意图自动从 query 识别**--官方文档原话"时间是信号，不是过滤器"。系统已追踪事件时间/记录时间，AI 在 query 里说"上个季度"即可，不需要 `event_date` 参数。
- **importance 有"重要性地板"**自动保护重要记忆不沦为"幽灵记忆"，不需要 `importance_min`。
- **fast/deep 自动切换**--deep 在"查询带时间意图或 fast 置信度不高时自动触发"。实测不传 `mode` = 0.5s（=fast），`mode=deep` = 3.6s；不传 `mode` 正好吃到正确的 fast 默认 + 自动升级，手动指定只会干扰。

实证数据支持"AI 不需要这些旋钮"：扫 103 次 memories 调用，**91% 是纯主题词**，时间意图 1%、类型意图 8%（且多为"配置/结论"这类主题词误匹配）、重要性意图 0%。AI 的心智模型是"塞主题词进 query，靠语义匹配"，暴露过滤参数不用，只增加 schema 噪音。

Context Bundle 默认禁用的理由：拆解 `/context/bundle` 返回，**working memory（Focus Areas + Briefing）占 55%**，是项目导向的 proactive 推送（"最近在做 Python 包发布 / skill-manager / OneReason"）。当前任务不在这些项目里时，它是错位的强信号，会干扰 AI 目标。按需 `nmem_search` / `nmem_list_threads`（精确、相关）优于 proactive 推送历史。禁用后 `startupGuidance` 仍注入，AI 知道有 nmem 工具可用，按需能力不丢；连带的 Owner Identity 损失小（pi 的 AGENTS.md / 系统提示已覆盖身份与语言）。

`limit 10 -> 5` 的依据：threads 96% 的 `read_thread` 命中 top3、rank 4-10 仅 4%；memories AI 主动调 limit 时选 5-8、从不 <5；memory 碎片化小（单条 content median 477 字符）全文直给合理，体量 = 条数 × 单条，降条数直接有效且无 read 路径也不反噬（search 准 + memory 小）。

## 考虑过的选项

- **暴露 `unit_type`**：rejected--nmem"语义主导"哲学下硬过滤会裁掉其他类型里语义相关的记忆；AI 8% 类型意图多误匹配，无真实需求。
- **加 `read_memory` 两阶段**（search 给摘要 + read 取全文，仿 `nmemReadThread` 的 BUDGET 分段）：rejected--memory 碎片化小，全文直给合理，`read_memory` 是把 thread 的尺度错配到 memory，过度设计。
- **暴露时间 / importance 过滤**：rejected--系统已自动从 query 识别时间、importance 有地板保护。
- **暴露 `mode`**：rejected--后端自动 fast/deep 切换更优，手动指定干扰。
- **Context Bundle 默认开启**：rejected--working memory proactive 推送干扰目标。

## 后果

- 工具 schema 精简（`query + limit`），AI 认知负担低、选择面小不易乱猜。
- AI 靠 query 语义 + nmem 智能排序获取记忆；需精确缩小结果时用更具体的 query 或调 `limit`。
- Context Bundle 默认关，用户可 `/nmem-config injectContextBundle true` 手动开启。
- `limit` 默认 5；AI 需要更多候选时主动调大。
- 如未来 nmem 后端支持 Context Bundle 分段裁剪（session-start 只带身份/规则，working memory 作为独立 surface 按需查询--nmem 自己已有独立 `working-memory` CLI），可重新评估 bundle 默认值。
