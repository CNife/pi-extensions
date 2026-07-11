# cnife-pi-extensions

CNife's [pi](https://pi.dev) agent extensions — 多个小技能架构，受 [Matt Pocock skills](https://github.com/mattpocool/skills) 启发。

Refer to [AGENTS.md](AGENTS.md) for the project structure, directory conventions, and skill architecture.
Refer to [CONTEXT.md](CONTEXT.md) for the project's domain glossary.

## Packages

| 包 | 类型 | 说明 |
|---|------|------|
| [`@cnife/pi-agent-loop-reflection`](#agent-loop-reflection) | Extension | 长时 agent loop 自动插入反思提醒 |
| [`@cnife/pi-auto-naming-session`](#auto-naming-session) | Extension | turn 边界自动生成/刷新会话标题 |
| [`@cnife/pi-cache-hit-rate`](#cache-hit-rate) | Extension | 在 footer 中显示当前会话累计缓存命中率 |
| [`@cnife/pi-execute-python`](#execute-python) | Extension | 用 uv 执行 Python，实时流式输出，自动依赖管理 |
| [`@cnife/pi-inference-speed`](#inference-speed) | Extension | footer 显示推理速度 TPS 和首 token 延迟 TTFT |
| [`@cnife/pi-miscs`](#miscs) | Extension | 调试 & 快捷退出等小工具 |

### Deprecated packages

| 包 | 最终版本 | 退役日期 | 说明 |
|---|---------|---------|------|
| `@cnife/pi-change-based-workflow` | 0.2.1 | 2026-07-11 | 被 rpiv 流水线取代，源码见 [archive/](archive/) |
| `@cnife/pi-obsidian-diary` | 0.1.1 | 2026-07-11 | 不再维护（skill 仍独立维护），源码见 [archive/](archive/) |
| `@cnife/pi-simple-plannotator` | 0.1.6 | 2026-07-11 | 改用 `@plannotator/pi-extension`，源码见 [archive/](archive/) |

## Install

安装整个仓库（包含所有包）：

```bash
pi install git:github.com/CNife/pi-extensions
```

单独安装某个包：

```bash
pi install npm:@cnife/pi-agent-loop-reflection
pi install npm:@cnife/pi-auto-naming-session
pi install npm:@cnife/pi-cache-hit-rate
pi install npm:@cnife/pi-execute-python
pi install npm:@cnife/pi-inference-speed
pi install npm:@cnife/pi-miscs
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

### cache-hit-rate

在 pi footer 的状态行中显示当前会话的累计缓存命中率：

- 文案格式：`Cached 99.99%`
- 统计口径：`cacheRead / (input + cacheRead + cacheWrite)`
- 颜色阈值：`<75%` 红，`75%-85%` 黄，`85%-95%` 默认前景色，`>=95%` 绿

### agent-loop-reflection

在长时间运行的 agent loop 中自动插入反思提醒：默认每 10 个有效 turn 触发，要求模型暂停确认目标、证据和阻塞状态，必要时调用 `advisor`；用 `steer` 作为可见用户消息插入，反思 turn 不计入下次倒计时，用户消息会重置倒计时。

### auto-naming-session

在 turn 边界自动生成并刷新会话标题。

### inference-speed

在 pi footer 显示当前 assistant message 的推理速度（TPS = output tokens / 生成耗时）和首 token 延迟（TTFT）。格式 `12.3T/s FT1.2s`，无数据时 dim 色占位，每条 message 结束后刷新。

### miscs

| 扩展 | 说明 |
|------|------|
| `debug-request-body` | 设置 `PI_DEBUG_REQUEST_BODY=<dir>` 后，将每次 provider 请求体 dump 到指定目录 |
| `exit` | 输入 `exit` 快捷退出 pi |

---

## License

MIT
