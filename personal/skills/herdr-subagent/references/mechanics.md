# herdr-subagent 机制详情

SKILL.md 的判断力与协议之外的实现机制。出问题时按这里的线索调试。

## frontmatter 契约

agent .md 的 YAML frontmatter 只认几个核心字段，其余运行时接管或忽略：

| 字段 | 处理 |
|---|---|
| (body) | 角色提示词 -> 写入 `workdir/role.md`，`--append-system-prompt <role.md 路径>`（默认）/ `--system-prompt`（`system-prompt-mode: replace` 时替换 pi 默认） |
| `model` | `--model`（支持 `provider/id` 带斜杠） |
| `thinking` | `--thinking`（off/minimal/low/medium/high/xhigh/max） |
| `tools` | `--tools` 白名单（逗号空格已剥成纯逗号） |
| `deny-tools` | `--exclude-tools` |
| `name` | 派生为 herdr agent 名（取文件名 stem，小写、非法字符替 `-`、截断 28、重名追加 `-2`/`-3`）；`--name` 覆盖 |
| `description` | 忽略（人读） |
| `spawning`/`auto-exit`/`session-mode` | 丢字段；行为运行时常开（pi 无 Agent 工具；settled 后收 pane；用 `--session-dir` 而非 `--no-session`） |
| `system-prompt-mode` | `replace` -> 用 `--system-prompt` 替换 pi 默认系统提示词；缺省/其它 -> `--append-system-prompt`（保留 pi 默认工具使用指引） |

运行时另加（非 frontmatter）：`--session-dir <workdir>`（会话 jsonl 隔离到 workdir、可抽取、随清理）。不传 `--no-context-files`（加载 AGENTS.md/CLAUDE.md）；不传 `--no-session`（后者不留可抽取会话）。

## 生命周期状态机

herdr 的 agent 状态（`agent get` 的 `agent_status`）+ 脚本派生态：

```text
                ┌──────────┐
   agent start →│ working  │← task 下发后
                └────┬─────┘
        ┌────────────┼────────────┐
        ↓            ↓            ↓
   ┌─────────┐  ┌─────────┐  ┌──────────┐
   │  idle   │  │ blocked │  │ unknown  │
   │(pane被见)│  │(在提问)  │  │(识别不准)│
   └────┬────┘  └────┬────┘  └────┬─────┘
        │            │            │
        ↓            ↓            ↓
     result      介入/send-keys  read 瞄一眼
        │
        ↓
      close

   done = 未被见过的后台完成（同 idle 底层态）
   agent 退出（agent_not_found 且注册表有记录）→ wait 报 done
   未 spawn/已 close（注册表无记录）→ 死名字，wait 跳过；全部跳过 → exhausted
   idle/done 认作 settled 须曾 working（注册表 entry['worked'] 持久化）
   超时仍 working/unknown，或 idle 从未 working → wait 报 stalled
```

`wait` 返回 `idle`/`done`/`blocked` 任一 settled 态都有效；`blocked` 时子代理在提问（转交人或 `send-keys` 介入）；`stalled` 时无生命周期变化（`herdr agent read` 瞄一眼）；`exhausted` 时没有可等候选（`name` 为空，循环终止信号）。`close` 不论状态都回收。

**settled 让位靠 close，不是 result**：wait 对已 settled 的名字没有消费标记，
result 后它仍会命中 wait——必须 result + close 成对处理、并把该名字移出下次 wait 的列表，
否则并行循环会卡在同一个名字上。死名字（未 spawn/已 close）不返回 done，直接跳过。

**working 门槛（防待命误判）**：task 下发前 spawn 出的子代理就是 idle（空闲待命），
与完成后的 idle 无法从 agent_status 区分；且待命时 `--session-dir` 的 jsonl 尚未创建，
此时 result 只会 fallback 到带启动横幅的 transcript。故 idle/done 须曾见 `working`
（首次 working 时写注册表 `entry['worked']`，跨 wait 调用持久化——并行接手是多次独立
wait 调用，进程内的记忆会在下一次丢失）才认作 settled。spawn 不设，close 删 entry 即消失。

## 关键机制

### cwd ≠ workdir

- `herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$PWD" --label <子代理名> --no-focus` 开独立 tab（一代理一 tab），用**调用方 cwd**（你的仓库）--子代理操作你的仓库。`--workspace` 必须显式传：缺省时 herdr 落到默认 workspace，不是调用方的。
- workdir（mktemp 临时目录）只放 `task.md`/`role.md`/会话 jsonl，靠 `--session-dir <workdir>` 隔离会话。
- 交付协议提示词给 task.md 的**绝对路径**（`workdir/task.md`），子代理跨 cwd 也能读到。

### 系统提示词走文件路径

herdr 拒绝多行 inline 参数（`invalid_agent_argument`），故 `--append-system-prompt`/`--system-prompt` 传角色**文件路径**（`workdir/role.md`），pi 读取文件内容（原型验证：角色被采纳）。默认 append（保留 pi 默认工具使用指引）；`system-prompt-mode: replace` 时替换。

### shell 落定竞态

`tab create` 后新 tab root pane 的 shell 需落定到交互提示符再 `agent start`，否则竞态 "not available shell"。脚本重试 `agent start`（匹配错误信息含 "shell"，~6 次 × 0.7s），非 shell 错误立即抛出。

### 对话式回传（结果走回复，不走文件）

子代理最终回复即结果，主代理从会话 jsonl 抽主路径最后 assistant 全文。理由：只读子代理（无 `write`）写不了结果文件；对话式回传让它保持真·只读（原型验证：只读 + 文件交付冲突--只读子代理死循环试图读它写不了的结果文件）。

- 抽取用 pi-session-query 的**公开 API**（`s.entries` + `s.leaf()`），手动回溯 `parentId` 链，**从 leaf 端找第一条 assistant**（= 主路径上最后一条 assistant = 最终回复）的 text block，**绕过** `s.messages()`/`s.blocks()` 的默认 200 字截断取全文。不能反过来从 root 端取第一条：那会命中会话最早的 assistant（常为 thinking+toolCall 中间步骤，无 text block），空抽取触发 transcript 回退、带回启动横幅噪声。
- 空结果回退 `herdr agent read <name> --source recent-unwrapped` transcript，绝不丢失输出。

### 注册表

`~/.cache/herdr-subagent/registry.json`（env `HERDR_SUBAGENT_REGISTRY` 覆盖），映射 `name -> {tab_id, pane_id, workdir, md_path, worked?}`。spawn 写入，close 注销。**运行时以 herdr 活态为准**（`agent get`），注册表仅作清理回退（手动关 tab 后注册表会 stale）。close 优先 `tab close <tab_id>`（整 tab 连带回收）；旧 entry 无 `tab_id` 时回退 `pane close <pane_id>`。`worked`（可选）是 working 痕迹：首次见 `agent_status=working` 时置位，供 wait 的 settled 判定（防待命 idle 误判），close 随 entry 删除。`result` 优先从 `agent get` 的 `agent_session.value` 取 jsonl 路径，**value 无效（文件不存在）时回退**注册表 workdir 的 `*.jsonl` glob（jsonl 尚未创建/路径陈旧时兜底）。

### 跨技能脚本定位

`result` 调 pi-session-query 的 `query.py`，按以下顺序定位：env `PI_SESSION_QUERY_SCRIPT` > 同级技能路径 `<本脚本>/../../pi-session-query/scripts/query.py`（仓库源码与 `~/.agents/skills/` 安装布局都成立）> `~/.agents/skills/pi-session-query/scripts/query.py`。

### 透明性

每个原语输出最小 schema JSON（`{name, tab, pane, workdir, jsonl}`/`{sent}`/`{name, state}`/`{text}`/`{ok}`）；错误输出 `{"error":true,"type":...}`（exit 2 用法/文件，exit 1 运行时）。出问题时看输出 + `herdr agent get/read` + workdir 里的 jsonl。
