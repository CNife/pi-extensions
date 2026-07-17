# cnife-pi-extensions

CNife's [pi](https://pi.dev) agent extensions — 多个小技能架构，受 [Matt Pocock skills](https://github.com/mattpocool/skills) 启发。

Refer to [AGENTS.md](AGENTS.md) for the project structure, directory conventions, and skill architecture.
Refer to [CONTEXT.md](CONTEXT.md) for the project's domain glossary.

## Packages

| 包 | 类型 | 说明 |
|---|------|------|
| [`@cnife/pi-agent-loop-reflection`](#agent-loop-reflection) | Extension | 长时 agent loop 自动插入反思提醒 |
| [`@cnife/pi-auto-naming-session`](#auto-naming-session) | Extension | turn 边界自动生成/刷新会话标题 |
| [`@cnife/pi-execute-python`](#execute-python) | Extension | 用 uv 执行 Python，实时流式输出，自动依赖管理 |
| [`@cnife/pi-inference-speed`](#inference-speed) | Extension | footer 显示推理速度 TPS 和首 token 延迟 TTFT |
| [`@cnife/pi-inline-skill-completion`](#inline-skill-completion) | Extension | 输入框任意位置补全技能，支持一行多个并折叠渲染 |
| [`@cnife/pi-miscs`](#miscs) | Extension | 调试 & 快捷退出等小工具 |
| [`@cnife/pi-nmem`](#nmem) | Extension | 用 pi 原生 tool 打 nmem 后端 REST（搜索/深读/保存记忆），替代 nowledge-mem-pi，不依赖 nmem CLI |

### Deprecated packages

| 包 | 最终版本 | 退役日期 | 说明 |
|---|---------|---------|------|
| `@cnife/pi-change-based-workflow` | 0.2.1 | 2026-07-11 | 已退役，源码见 [archive/](archive/) |
| `@cnife/pi-obsidian-diary` | 0.1.1 | 2026-07-11 | 不再维护（skill 仍独立维护），源码见 [archive/](archive/) |
| `@cnife/pi-simple-plannotator` | 0.1.6 | 2026-07-11 | 改用 `@plannotator/pi-extension`，源码见 [archive/](archive/) |
| `@cnife/pi-cache-hit-rate` | 0.4.1 | 2026-07-14 | pi 原生已支持 cache hit footer 与 /session 缓存统计，源码见 [archive/](archive/) |

## Install

安装整个仓库（包含所有包）：

```bash
pi install git:github.com/CNife/pi-extensions
```

单独安装某个包：

```bash
pi install npm:@cnife/pi-agent-loop-reflection
pi install npm:@cnife/pi-auto-naming-session
pi install npm:@cnife/pi-execute-python
pi install npm:@cnife/pi-inference-speed
pi install npm:@cnife/pi-inline-skill-completion
pi install npm:@cnife/pi-miscs
pi install npm:@cnife/pi-nmem
```

---

## Extensions

### execute-python

注册 `executePython` 工具，用 [uv](https://docs.astral.sh/uv/) 执行 Python 代码：

- 实时流式输出（`onUpdate`）
- 自定义 TUI 渲染
- 进程组管理（detached + signal 清理）
- 纯文本内容供 LLM 消费
- 错误信息完整展示

### agent-loop-reflection

在长时间运行的 agent loop 中自动插入反思提醒：默认每 10 个有效 turn 触发，要求模型暂停确认目标、证据和阻塞状态，必要时调用 `advisor`；用 `steer` 作为可见用户消息插入，反思 turn 不计入下次倒计时，用户消息会重置倒计时。

### auto-naming-session

在 turn 边界自动生成并刷新会话标题。

### inference-speed

在 pi footer 显示当前 assistant message 的推理速度（TPS = output tokens / 生成耗时）和首 token 延迟（TTFT）。格式 `12.3T/s FT1.2s`，无数据时 dim 色占位，每条 message 结束后刷新。

### inline-skill-completion

在输入框**任意位置**输入 `/` 补全已安装技能（`/skill:<name>`），支持一行提交多个技能，每个渲染为独立的原生 `[skill]` 可折叠块。行首 `/` 仍委托原生 slash 命令补全。

### miscs

| 扩展 | 说明 |
|------|------|
| `debug-request-body` | 设置 `PI_DEBUG_REQUEST_BODY=<dir>` 后，将每次 provider 请求体 dump 到指定目录 |
| `exit` | 输入 `exit` 快捷退出 pi |

### nmem

替代 [nowledge-mem-pi](https://github.com/nowledge-labs/nowledge-mem-pi) 的 pi 扩展，用 pi 原生 custom tool 把 nmem 后端能力暴露给 LLM，内部纯打 nmem 后端 REST，不依赖 nmem CLI。

- **3 个 tool**：`nmem_search`（搜记忆/会话）、`nmem_read_thread`（深读会话全文、自动分段）、`nmem_save_memory`（upsert 记忆，结构化参数零转义）
- **ambient**：会话自动同步为 nmem 线程 + 启动注入 Context Bundle
- 运行时只需 nmem 后端 REST 可达；低频操作仍可用裸 `nmem` CLI

---

## License

MIT
