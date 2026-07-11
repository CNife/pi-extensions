# cnife-pi-extensions

CNife's [pi](https://pi.dev) agent extensions — 多个小技能架构，受 [Matt Pocock skills](https://github.com/mattpocool/skills) 启发。

Refer to [AGENTS.md](AGENTS.md) for the project structure, directory conventions, and skill architecture.
Refer to [CONTEXT.md](CONTEXT.md) for the project's domain glossary.

## Packages

| 包 | 类型 | 说明 |
|---|------|------|
| [`@cnife/pi-execute-python`](#execute-python) | Extension | 用 uv 执行 Python，实时流式输出，自动依赖管理 |
| [`@cnife/pi-cache-hit-rate`](#cache-hit-rate) | Extension | 在 footer 中显示当前会话累计缓存命中率 |
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
pi install npm:@cnife/pi-execute-python
pi install npm:@cnife/pi-cache-hit-rate
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

### miscs

| 扩展 | 说明 |
|------|------|
| `debug-request-body` | 设置 `PI_DEBUG_REQUEST_BODY=<dir>` 后，将每次 provider 请求体 dump 到指定目录 |
| `exit` | 输入 `exit` 快捷退出 pi |

---

## License

MIT
