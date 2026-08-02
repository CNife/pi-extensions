---
name: herdr-subagent
description: 用 herdr 驱动 pi 子代理的薄运行时。运行在 Herdr 内（HERDR_ENV=1）且要把工作委派给隔离子代理（上下文保护 / 并行 / 边界明确的执行）、或别的技能需要同时开多个隔离子代理时使用。
---

# Herdr Subagent - herdr 驱动的薄子代理运行时

把 herdr 的 agent 协调原语 + pi 的启动参数复用一个**薄子代理运行时**，不造框架。每个子代理是一个真实 pi 跑在**独立 herdr tab** 里（一代理一 tab）--在 TUI 里可见、可聚焦、可 `send-keys` 介入。任务走隔离临时目录交接，结果走对话回传（子代理最终回复即结果）。

**前置**：运行在 Herdr 内（`test "${HERDR_ENV:-}" = 1`），`herdr` 与 `pi` 在 PATH。跨依赖 [herdr](skill://herdr)（pane/agent 协调；第三方 skill-manager 源 ogulcancelik/herdr）与本仓库 [pi-session-query](../pi-session-query)（结果抽取）。脚本入口 `<技能目录>/scripts/subagent.py`，路径相对本 SKILL.md 所在目录解析，勿按 CWD。

## 何时委派（判断力为先）

先判断**该不该**委派，再谈怎么委派。子代理是为隔离/并行/编排，不是为琐碎内联活儿。

**三个委派理由**（满足其一才考虑）：

1. **上下文保护**--探索/调研的噪声不该进你的主上下文（读了一堆文件只为找一个事实）。
2. **并行**--多个相互独立的任务可同时跑，按最慢的一个计费而非总和。
3. **编排**--把边界明确的子任务交给专家角色（explorer 找证据、reviewer 审变更、worker 执行）。

**inline-vs-delegate 速查**：

| 内联（别委派） | 委派 |
|---|---|
| 单步、需你当下判断 | 多步探索/调研 |
| 探索结果你立刻要用、要基于它决策 | 边界明确、产出是证据/报告 |
| 一两轮就能完 | 可与其它工作并行 |
| 任务本身就是要你综合 | 产出是事实集合，不是决策 |

**"写不出 brief 就没准备好"**：委派前必须能写出 brief（见下）。写不出 = 还没想清楚要什么，先想清楚再委派，否则子代理只会把你的模糊放大成它的跑偏。

**标准 brief 结构**（task 原语的任务文本按这个写）：

- **目标**：一句话，子代理要交付什么。
- **上下文**：相关绝对路径、已有结论、约束来源。
- **约束**：搜索范围、只读/可改、时间/深度上限。
- **期望产出**：证据格式（绝对路径:行号 / 来源 URL）、是否要分严重性、空结果算不算有效。

**致命失败模式**（永不触碰）：

- **永不委派综合/决策**。子代理收集证据、你做判断。把"该用哪个方案""这个设计行不行"委派出去 = 丢掉判断的所有权。委派的是**收集**与**执行**，不是**抉择**。
- **子代理里的 `bash` 是提示词级约束，非强制**。worker 的"只读"靠**工具白名单**（`tools`/`deny-tools` -> `--tools`/`--exclude-tools`），不是角色提示词里一句"你只读"。**pi 没有权限弹窗**，工具白名单才是真正的安全边界--提示词约束可被绕过，工具不在白名单里物理上调用不了。

## 协议（五个原语，异步默认）

主代理组合 `spawn -> task -> wait -> result -> close`。跟进/插话/瞄一眼等短操作直接用 herdr（`agent prompt`/`send-keys`/`agent read`），不包进脚本。

### Step 1：spawn - 启动子代理

```bash
uv run --script <技能目录>/scripts/subagent.py spawn <agent.md> [--name N]
```

读 .md 翻译成 pi 启动参数、mktemp 建临时目录（workdir）、写角色文件、`herdr tab create`（`--no-focus`、`--workspace` 用调用方的 `$HERDR_WORKSPACE_ID`、label 用子代理名、cwd 用调用方仓库目录）、等 shell 落定、`herdr agent start --kind pi`（`--session-dir` 指向 workdir）。输出 `{name, tab, pane, workdir, jsonl}`。

- `--name` 省略时从 .md 文件名派生（小写、非法字符替 `-`），重名自动追加 `-2`/`-3`。给 `--name` 则直接用（须合法且未被占用）。
- workdir 只放 `task.md`/`role.md`/会话 jsonl；子代理的 cwd 是**调用方仓库目录**（操作仓库），不是 workdir。

**完成条件**：输出含 `name`/`tab`/`pane`/`workdir`；`herdr agent get <name>` 能查到且 `agent_status` 非 `unknown`。

### Step 2：task - 下发任务（非阻塞）

```bash
uv run --script <技能目录>/scripts/subagent.py task <name> <任务文本>
```

把任务文本写进 `workdir/task.md`，再向子代理发固定交付协议提示词（指向 task.md 绝对路径："读它执行，最终回复即交付，不要把结果写入文件"），不等待。输出 `{sent: true}`。

- 任务文本按上面 brief 结构写（目标/上下文/约束/期望产出）。
- "不要把结果写入文件"指**别写结果文件**（结果走回复回传），不是"别改仓库"。worker 改仓库文件由任务本身界定；只读靠工具白名单。

**完成条件**：`{sent: true}`；`workdir/task.md` 已写入；子代理 `agent_status` 转 `working`。

### Step 3：wait - 等任一子代理 settled

```bash
uv run --script <技能目录>/scripts/subagent.py wait <name> [<name>...] [--timeout MS]
```

轮询命名的子代理，谁先 settled 返回谁。输出 `{name, state}`，`state` 取值：

| state | 含义 | 主代理动作 |
|---|---|---|
| `idle` | pane 被见过、就绪 | 取结果（Step 4） |
| `done` | 未被见过的后台完成 | 取结果（Step 4） |
| `blocked` | 子代理在提问/请求审批 | 转交人，或 `herdr agent send-keys`/`agent prompt` 介入 |
| `stalled` | 超时无生命周期变化 | `herdr agent read <name>` 瞄一眼再决定 |
| `exhausted` | 没有可等的子代理（候选全是死名字/已处理） | 停止等待循环；`name` 为空字符串 |
| `done`（agent 已退出） | spawn 过但进程已不在 | 取结果（可能不完整），然后 close |

`--timeout` 默认 120000ms。一次盯多个名时谁先停返回谁，便于并行逐个接手。

**并行接手（必须成对）**：wait 返回 settled（idle/done）后，必须 **result + close 成对**处理，
并把该名字移出下次 wait 的列表，否则它会一直挡住 wait（无消费标记，close 才让位）。
已 close/未 spawn 的死名字会被 wait 自动跳过、不报 done——列表里留着旧名字无害，
但全部被跳过时 wait 报 `exhausted`（`name` 为空，循环终止信号）。

**settled 有 working 门槛**：idle/done 须曾进入 `working` 才被认作完成（痕迹持久化在
注册表），防止把 task 前的空闲待命（idle、会话文件未建）误判为完成——否则 result 只能
回退到带启动横幅的 transcript。

**完成条件**：输出 `{name, state}`；按上表选择下一步（取结果 / 介入 / 瞄一眼 / 停止）。

### Step 4：result - 抽取最终回复

```bash
uv run --script <技能目录>/scripts/subagent.py result <name>
```

从该子代理的会话 jsonl 抽主路径上最后一条 assistant 消息的全文（用 pi-session-query，关掉截断取全文）。空结果回退 `herdr agent read` transcript。输出 `{text}`。

**完成条件**：`text` 非空且干净（无终端 transcript 噪声）；为空时已用 transcript 回退，绝不丢失子代理输出。

### Step 5：close - 回收（幂等）

```bash
uv run --script <技能目录>/scripts/subagent.py close <name>
```

`herdr tab close`（连带回收 tab 内 pane 与进程；旧注册无 tab_id 时回退 `pane close`）+ 删 workdir + 注销注册。不论子代理状态都回收；重复执行不报错。输出 `{ok: true}`。

**完成条件**：`{ok: true}`；tab 已关、workdir 已删、注册已注销。重复 close 仍 `{ok: true}`。

## worker / bash 安全告诫

- **工具白名单是真边界，提示词不是**。pi 无权限弹窗：`tools` 白名单外的工具物理上不可调用；角色提示词里的"你只读""别用 bash"是软约束，可被绕过。要只读就给 `tools: read, ffgrep, ...`（剥掉 `bash`/`edit`/`write`），别只靠提示词。
- **worker 才能改文件**。worker 用 `deny-tools`（收掉 `advisor`/记忆等），保留 `write`/`edit`，仅委派**边界明确**的执行任务（目标/步骤/验证/停止条件都写清）。永不委派需要设计决策的活儿给 worker。
- **reviewer/bash**：reviewer 可带 `bash` 但只用于只读命令（`git diff`/`cat`/`wc`/测试）。bash 的只读性靠角色提示词 + 你审计其会话，**不靠强制**--敏感仓库改用纯 `tools: read, ffgrep, fffind`（无 bash）的 reviewer。

## 机制详情

frontmatter 契约表（字段 -> pi 参数）、生命周期状态机、cwd≠workdir、系统提示词走文件路径、shell 落定竞态、对话式回传理由、注册表等长机制说明见 [`references/mechanics.md`](./references/mechanics.md)。

## 参考

- herdr 协调原语 -> [herdr 技能](skill://herdr)（pane/agent 命令、生命周期状态、安全规则）
- 会话抽取 -> [pi-session-query](../pi-session-query)（`s.entries`/`s.leaf()` 公开 API，主路径还原）
- pi 启动参数 -> `pi --help`（`--model`/`--thinking`/`--tools`/`--exclude-tools`/`--append-system-prompt`/`--session-dir`）
