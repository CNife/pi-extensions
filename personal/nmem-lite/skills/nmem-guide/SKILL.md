---
name: nmem-guide
description: 搜过去知识 / 存新知识 / 查 nmem 命令树时进来。
---

# nmem-guide

nmem 是本地优先、图谱增强的跨工具个人记忆层。

## 路由

- 该搜过去知识 → 读 `search.md`
- 该存新知识 → 读 `save.md`
- 查 nmem 能干什么 → 看下面

## 心智模型

nmem 的命令树（`nmem --help`）：

- **memories** — search/add/show/list + 生命周期（archive/forget/deprecate/supersede/move/link/evolves）
- **threads** — 会话管理（list/search/show/save/sync/capture/triage/distill）
- **fs** — Nowledge FS（ls/cat/find/grep/recall/stat）
- **library** — 文档库（list/add/read/search/extract）
- **graph** — 关联记忆 / 版本链（expand/evolves）
- **ask** — 跨记忆/会话/库/图谱的 grounded 问答
- **feed** — 活动流（inbox/reviews/catchup/kg-repair/resolve）
- **context** / **wm** — 启动上下文（opt-in，默认不注入，用户手动 `nmem context` / `nmem wm read`）
- **spaces** / **agents** / **rules** / **ontology** — 配置（大部分人一次性设置）
- **运维** — status / doctor / stats / serve / service / key / license / plugins / models / export / import / skills / schedules / tasks / team / tui

用时 `nmem <group> --help` 查具体子命令。失败先 `nmem status` / `nmem doctor`。

Managed Skills：pi 用原生 skill，`nmem skills match "<task>"` 查匹配。
