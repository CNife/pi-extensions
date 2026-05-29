# cnife-pi-extensions

CNife's [pi](https://pi.dev) agent extensions — 多个小技能架构，受 [Matt Pocock skills](https://github.com/mattpocool/skills) 启发。

Refer to [AGENTS.md](AGENTS.md) for the project structure, directory conventions, and skill architecture.
Refer to [CONTEXT.md](CONTEXT.md) for the project's domain glossary.

## Packages

| 包 | 类型 | 说明 |
|---|------|------|
| [`@cnife/pi-change-based-workflow`](#skills) | Skills | 变更驱动开发工作流：grill → plan → write-code → review |
| [`@cnife/pi-execute-python`](#execute-python) | Extension | 用 uv 执行 Python，实时流式输出，自动依赖管理 |
| [`@cnife/pi-cache-hit-rate`](#cache-hit-rate) | Extension | 在 footer 中显示当前会话累计缓存命中率 |
| [`@cnife/pi-simple-plannotator`](#simple-plannotator) | Extension | 浏览器内代码审查 & Markdown 批注 |
| [`@cnife/pi-miscs`](#miscs) | Extension | 调试 & 快捷退出等小工具 |

## Install

安装整个仓库（包含所有包）：

```bash
pi install git:github.com/CNife/pi-extensions
```

单独安装某个包：

```bash
pi install npm:@cnife/pi-change-based-workflow
pi install npm:@cnife/pi-execute-python
pi install npm:@cnife/pi-cache-hit-rate
pi install npm:@cnife/pi-simple-plannotator
pi install npm:@cnife/pi-miscs
```

---

## Skills

`@cnife/pi-change-based-workflow` — 采用**多个小技能**架构，每个技能职责单一，可自由组合。

### 核心阶段（流水线）

| 技能 | 说明 |
|------|------|
| `/grill` | 追问 + 领域对齐，澄清变更范围和用语 |
| `/plan` | 基于 grill 结论一次性写入 plan.md |
| `/plan-to-tasks` | 垂直切片拆解为可独立验证的子任务 |
| `/write-code` | TDD 红绿重构，逐 task 执行 |
| `/review-code` | AI 审查 + plannotator 人类审查 |

### 独立功能

| 技能 | 说明 |
|------|------|
| `/manage-change` | 变更目录管理：new、switch、status、list |
| `/improve-architecture` | 手动触发，扫描代码库发现架构改进机会 |

### 辅助技能（不入流水线，随时调用）

| 技能 | 说明 |
|------|------|
| `/prototype` | 可丢弃原型，验证代码层不确定性 |
| `/zoom-out` | 提升抽象层级，给出模块全景地图 |
| `/grill-me` | 纯追问，不写文件，不绑定变更 |
| `/handoff` | 会话交接，压缩对话为交接文档 |

### 诊断入口（按需触发，需安装 waza）

| 技能 | 说明 | 安装方式 |
|------|------|----------|
| `/hunt` | 根因诊断，出问题时调用 | `bunx skills add -g tw93/Waza` |

### 工作流全景

| 技能 | 说明 |
|------|------|
| `/cnife-pi-workflow` | 工作流全景：流水线顺序、技能关系、使用指南 |

### Quickstart

1. 创建变更目录：`/manage-change new <简写>`
2. 追问澄清：`/grill`
3. 写方案：`/plan`
4. 拆解任务：`/plan-to-tasks`
5. 实现：`/write-code`
6. 审查：`/review-code`

---

## Extensions

### execute-python

注册 `executePython` 工具，用 [uv](https://docs.astral.sh/uv/) 执行 Python 代码：

- 实时流式输出（`onUpdate`）
- 自定义 TUI 渲染
- 进程组管理（detached + signal 清理）
- 纯文本内容供 LLM 消费

### cache-hit-rate

在 pi footer 的状态行中显示当前会话的累计缓存命中率：

- 文案格式：`Cached 99.99%`
- 统计口径：`cacheRead / (input + cacheRead + cacheWrite)`
- 颜色阈值：`<75%` 红，`75%-85%` 黄，`85%-95%` 默认前景色，`>=95%` 绿

### simple-plannotator

基于 [@plannotator/pi-extension](https://www.npmjs.com/package/@plannotator/pi-extension) 的浏览器内审查工具：

| 命令 | 说明 |
|------|------|
| `/pnr` | 对本地 git 变更发起浏览器代码审查 |
| `/pna <path>` | 对 Markdown 文件或目录发起浏览器批注 |
| `/pnl` | 对最后一条助手消息进行批注 |

### miscs

| 扩展 | 说明 |
|------|------|
| `debug-request-body` | 设置 `PI_DEBUG_REQUEST_BODY=<dir>` 后，将每次 provider 请求体 dump 到指定目录 |
| `exit` | 输入 `exit` 快捷退出 pi |

---

## License

MIT
