# @cnife/pi-nmem

替代 nowledge-mem-pi 的 pi extension，用 pi-native custom tool 把 nmem 后端能力暴露给 LLM。

## 目标

根治 nowledge-mem-pi 的 skill 调用裸 `nmem` CLI 的三个痛点：
1. `--json` 输出冗长（占上下文）
2. AI 乱猜 nmem 参数
3. add 记忆与 bash 转义搏斗

根因是 "LLM -> shell -> nmem CLI" 中介层。改为 LLM 直接调用结构化 tool，跳过 shell。详见 [ADR-0001](../../docs/adr/0001-pi-native-tool-not-axi-cli.md)。

## 架构：一个 extension，三个职责

| 职责 | 做法 | 来源 |
|---|---|---|
| ① custom tool | 注册 3 个 tool，内部打 nmem REST | 全新 |
| ② ambient sync | 自动把 pi 会话同步为 nmem 线程 | fork nowledge-mem-pi extension |
| ③ 启动上下文注入 | session_start 注入 Context Bundle | fork，启动注入改打 `GET /context/bundle`（摆脱 nmem CLI 依赖） |

引导层：`promptGuidelines` 管"何时调 tool"，项目 `AGENTS.md` 管复杂检索路由（沿用 nowledge-mem-pi 模式）。

## tool surface（3 个，纯打 REST）

| tool | REST 端点 | 用途 |
|---|---|---|
| `nmem_search(query, kind?, limit?)` | `POST /memories/search` / `GET /threads/search` | 搜记忆（kind=memories，默认）或会话（kind=threads） |
| `nmem_read_thread(thread_id, offset?, limit?)` | `GET /threads/{id}` | 深读会话，自动分段 + "还有 N 条"提示 |
| `nmem_save_memory(title, content, unit_type?, importance?, labels?, id?)` | `POST /memories` / `PATCH /memories/{id}` | upsert 记忆；content 作参数零转义 |

**不占 tool 槽**（交给 extension ambient）：read_context、status、sync。
**留裸 `nmem` CLI**：save_thread（handoff）、记忆/线程批量管理、系统管理。

## 替代关系

卸载 nowledge-mem-pi，安装 @cnife/pi-nmem。等价功能 + 痛点根治。运行时只需 nmem 后端 REST 可达，不依赖 nmem CLI。

## 待定（实现细节）

- fork extension 的改造点
- tool 返回的精简 schema（AXI §2 精神：最小字段）
- 错误结构化 + 降级策略（后端不可达）
- tool 数量纪律（默认 3 个，按需 `setActiveTools` gate）

## 参考

- 架构决策：[ADR-0001](../../docs/adr/0001-pi-native-tool-not-axi-cli.md)
- 调研：[docs/nmem-usage-patterns.md](./docs/nmem-usage-patterns.md)
- 术语：根 [CONTEXT.md](../../CONTEXT.md) 的 nmem 集成 section
