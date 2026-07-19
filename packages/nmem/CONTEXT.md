# nmem 扩展术语表

本文件是 `@cnife/pi-nmem` 扩展的领域术语表，记录 nmem 集成相关概念。项目通用术语见根 [CONTEXT.md](../../CONTEXT.md)。

## nmem 集成

**nmem 后端**：
localhost REST 服务（默认 <http://127.0.0.1:14242），记忆/会话/上下文的> single source of truth。pi-nmem 扩展的后端。
_避免_：nmem CLI（CLI 是后端的命令行客户端）

**nowledge-mem-pi**：
被 pi-nmem 替代的现有 pi 插件，由 extension（自动同步 + 启动注入）和 5 个 skill（写死裸 `nmem --json` 调用）组成。
_避免_：nmem 插件（歧义）

**ambient sync**：
扩展在会话生命周期中自动把 pi 会话同步为 nmem 线程，LLM 不参与。
_避免_：手动导入

**Context Bundle**：
nmem 后端 `GET /context/bundle` 返回的启动上下文包，含 owner 身份、agent 身份、活跃 space、rules、working memory。pi-nmem 在 session_start 注入。
_避免_：working memory（是其子部分）

**会话开始时刻** (session start time)：
会话首条消息的发生时刻，是会话的固有属性。按时间切分会话（如划分工作日窗口）应以此为准；`nmem_read_thread` 返回的首条消息时刻即此。
_避免_：与「导入时间」混淆

**导入时间** (import time)：
ambient sync 将会话首次写入 nmem 后端的时刻，晚于会话开始时刻。只反映"何时入库"，不反映"会话何时发生"；`nmem_list_threads` 的列表时间是其近似，仅供粗筛。
_避免_：当作会话开始时刻用于精确切分
