# nmem 集成术语表

本文件是 nmem 集成的**共用**术语表：产品包 `@cnife/pi-nmem` 与 personal 层 `nmem-lite` 是同一后端的两个实现，共用这一份语言。项目通用术语见根 [GLOSSARY.md](../../GLOSSARY.md)。

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

**快照** (snapshot)：
一次同步要落盘的整份会话消息列表。同步永远写整份快照、由后端去重，所以"放弃一轮同步"只影响及时性，不丢内容——下一次同步、或下次打开该会话会补齐。
_避免_：增量、diff

**刚性 flush**：
由会话生命周期事件（退出、换会话、压缩前）触发的立即同步，走前台预算（用户可见的等待上限），并取消挂起的防抖 flush。
_避免_：强制同步、强制 flush

**防抖 flush**：
一轮结束后排定、到点才构建快照的后台同步，走后台预算、用户不可见。快照在到点时构建，因此窗口内新增的消息不会被漏掉。
_避免_：延迟同步、定时同步

**引导注入**：
扩展把 nmem 能力提示写进结构化系统提示 section，让模型自己知道可以用 nmem，而不是整段替换系统提示。
_避免_：系统提示替换（那是另一回事）
