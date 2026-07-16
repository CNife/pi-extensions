# nmem CLI 使用模式研究

> 调研日期：2026-07-15
> 目的：为设计更好的 agent 包装命令（axi）提供依据
> 方法：阅读 nmem CLI 源码/文档 + 分析 Pi Agent session 记录中的真实使用模式

---

## 1. 环境信息

| 属性 | 值 |
|------|-----|
| CLI 路径 | `~/.local/bin/nmem → ~/.local/share/uv/tools/nmem-cli/bin/nmem` |
| 版本 | `nmem 0.10.27` |
| 安装方式 | uv 工具 |
| 后端状态 | `ok`，本地模式，API `http://127.0.0.1:14242` |
| 服务模式 | 未安装 systemd 服务（`nmem service install` 未执行） |

**来源**: `which nmem`, `nmem --version`, `nmem status`, `nmem service status`

---

## 2. 命令全景

nmem 提供 20+ 个顶层命令，通过 `nmem --help` 获取完整列表。以下是按功能域的归类。

### 2.1 会话/线程操作（最常用）

```
nmem threads|t list    [-n LIMIT] [--offset] [--source] [--space] [--json]
nmem threads|t show ID [--limit N] [--offset N] [--content-limit N] [--json]
nmem threads|t search QUERY...
nmem threads|t create  --title TITLE [--content|-c|--messages|-m|--file|-f]
nmem threads|t import  [--file|-f FILE] [--messages|-m JSON] [--title|-t] [--stdin]
nmem threads|t save    --from <host> [--mode current|all] [--session-id] [--summary]
nmem threads|t sync    --from <host> [--apply] [--all-projects] [--limit]
nmem threads|t append  ID [--messages|-m JSON|--content|-c TEXT] [--role]
nmem threads|t delete  ID
nmem threads|t triage  [THREAD_ID|--content|-c|--file|-f]
nmem threads|t distill THREAD_ID
```

**来源**: `nmem t --help`, `nmem t list --help`, `nmem t show --help`, `nmem t create --help`, `nmem t import --help`, `nmem t save --help`, `nmem t sync --help`, `nmem t append --help`

### 2.2 记忆操作

```
nmem memories|m search QUERY...  [--label|-l] [--time|-t] [--unit-type]
                                  [--importance-min] [--mode normal|deep]
                                  [--recorded-from/to] [--event-from/to]
                                  [--limit] [--json]
nmem memories|m add    CONTENT  -t TITLE [--unit-type] [-i IMPORTANCE] [-l LABEL]
nmem memories|m show   ID
nmem memories|m list   [--limit] [--time] [--unit-type] [--json]
nmem memories|m update ID [--title] [--content] [--importance] [--unit-type]
nmem memories|m delete/archive/forget/deprecate/supersede ID
nmem memories|m move   ID [--space]
```

**来源**: `nmem m --help`, `nmem m search --help`, `nmem m add --help`

### 2.3 系统管理

```
nmem status        # 服务器健康检查 + 版本
nmem serve         # 运行后端服务器
nmem service       # 管理 systemd 服务（install/start/stop/status/uninstall）
nmem config        # 连接配置（API URL + key）
nmem plugins       # 插件管理
nmem models        # 嵌入模型管理（status/download/reindex）
```

**来源**: `nmem status --help`, `nmem service --help`

### 2.4 数据导入导出

```
nmem export  PATH   [--overwrite] [--no-zip] [--no-memories|threads|...]
nmem import  PATH
```

**来源**: `nmem export --help`

### 2.5 上下文与知识发现

```
nmem working-memory|wm  [read|edit|patch|history]  [--date DATE]
nmem context            [--space]  # Owner/agent/space/rules bundle
nmem feed               [--days N] [--type TYPE] [--from/to DATE] [--limit]
nmem fs                 [ls|cat|find|grep|recall|stat|write|rm|capabilities]
nmem wiki               [read|export|list]
nmem graph              [expand|evolves]
nmem entities           [create|show|search|update|delete|list]
nmem ask                QUERY...
nmem library|s|lib|l    [list|add|read|search|delete]
nmem communities        [list|show|search]
```

**来源**: `nmem working-memory --help`, `nmem feed --help`, `nmem fs --help`, `nmem ask --help`

### 2.6 空间与权限

```
nmem spaces      [list|create|delete|rename|...]
nmem license     [status|activate]
nmem key         [show|rotate]
nmem skills      [search|show|install|list|uninstall|sync]
nmem agents      [list|create|show|update|delete]
nmem rules       [list|edit|show|delete|read]
nmem tui         # 启动交互式 TUI
```

**来源**: `nmem --help`

---

## 3. session 记录中观察到的使用模式

以下模式来自 Pi Agent session 文件的全文搜索（约 30 个 session 文件匹配 `nmem`）。

### 3.1 高频命令（命中次数排序）

| 命令模式 | 命中数 | 文件来源 |
|---------|--------|---------|
| `nmem t show` | 56 | `personal_code-skills/2026-07-14T06-55-06...` |
| `nmem t list` / `nmem --json t list -n 25` | 10+9 | `personal_code-skills/2026-07-14T06-55-06...` |
| `nmem t list` | 21 | `personal_code-skills/2026-07-03T13-45-14...` |
| `nmem t show` | 24 | `personal_code-skills/2026-07-03T13-45-14...` |
| `nmem t show`（分段参数） | 56 | 同上 |
| `nmem --version` | 3 | `personal_code-skills/2026-07-03T13-45-14...` |
| `nmem t save --from` | 4+ | `personal_code-nmem-import-pi-sessions/2026-06-10...` |
| `nmem status` | 3 | `personal_code-nmem-import-pi-sessions/2026-06-10...` |
| `nmem --json t create` | 2 | `personal_code-nmem-import-pi-sessions/2026-06-10...` |
| `nmem t import` | 3 | 同上 |
| `nmem m search "query"` | 1 | `personal_code-skills/2026-07-03T13-45-14...` |
| `nmem t search "query"` | 1 | `personal_code-skills/2026-06-16T05-39-05...` |
| `nmem serve` | 1 | 同上 |
| `nmem export` | 1 | `personal_code-nmem-import-pi-sessions/2026-06-10...` |
| `nmem plugins check` | 1 | 同上 |
| `nmem feed` | 1 | `personal_code-skills/2026-07-14T06-55-06...` |

**来源**: rg 全文搜索 `/home/cnife/.pi/agent/sessions/` + `/home/cnife/.omp/agent/sessions/`

### 3.2 典型使用流程

#### A. daily-recap 中的会话收集流程（最完整的使用场景）

来自 `personal_code-skills` 下的 daily-recap skill 开发 session。

```
# 健康检查
nmem --version

# 列出最近线程（获取今日线程列表）
nmem --json t list -n 25

# 从输出中按 created_at 筛选今天创建的线程
# 对每个线程：

# 读取会话内容（分段提取）
nmem --json t show "<thread_id>" --limit 5 --offset 0 --content-limit 1000
nmem --json t show "<thread_id>" --limit 5 --offset 5 --content-limit 1000
# ... 直到所有消息读取完毕
```

**关键观察**:
- `--json` 用于脚本解析，纯文本用于人读
- session 读取要**分段**——`--offset 0`, `--offset 5`, `--offset 10`——因为 `--limit` 默认 10 不够读完整对话
- `--content-limit 1000` 截断长消息
- 本地已有 jsonl 文件的 session 不调 `nmem t show`，只有远程 session 才调

#### B. 导入 session 到 nmem（一次性任务）

来自 `personal_code-nmem-import-pi-sessions` session。

```
# 方法 1：从文件导入
nmem threads create --id "pi-{uuid}" --title "..." --messages '[...]'

# 方法 2：从 JSON 文件导入
nmem threads import --file session.md

# 方法 3：批量导入目录
nmem threads import --directory pi-sessions-md

# 方法 4：从其他 agent 保存
nmem threads save --from claude-code
nmem threads save --from gemini-cli
```

**关键观察**:
- 4 种不同的导入方式，参数模型不一致
- `nmem threads create --id` 需要手动构造消息 JSON
- `nmem threads import --file` 接受 markdown 或 JSON
- `nmem threads save --from` 自动发现 agent session——最方便但仅限受支持 agent

#### C. 记忆搜索

来自 `personal_code-skills` 中 search-memory 技能使用。

```
# 语义搜索
nmem memories search "项目关键词 工作" --json
nmem --json m search "query"
```

**关键观察**:
- 语义搜索需要精确的关键词
- 输出包含重要性、类型、标签，但 agent 要自己解析

#### D. 状态检查与故障处理

来自 daily-recap skill 的故障处理表格。

```
# 检查 nmem 可用性
nmem --version
# 失败时 hard stop，fallback 到本地 jsonl
```

**故障模式**:
| 症状 | 原因 | 处理 |
|------|------|------|
| nmem 不可用 | CLI 未安装/未登录 | Hard stop，询问用户是否仅看本机会话 |
| `nmem t list` 无今日线程 | 今天未通过 nmem 同步 | 仅用本机会话文件 |
| `nmem t show` 超时/空 | nmem 服务端问题 | 标记该会话"内容待补充" |
| nmem 有线程但本地无对应文件 | 其他机器的会话 | 按远程会话流程处理 |

---

## 4. 痛点分析

### 4.1 会话读取啰嗦

`nmem t show` 需要多次调用才能读完一个完整会话：

```
nmem t show <id> --limit 5 --offset 0   # 第 1 次
nmem t show <id> --limit 5 --offset 5   # 第 2 次
nmem t show <id> --limit 5 --offset 10  # 第 3 次
...
```

**影响**: agent 需要写循环或多次 tool call；人需要记住上次 offset

### 4.2 参数冗长

典型调用：
```
nmem --json t show "<thread_id>" --limit 5 --offset 0 --content-limit 1000
```

`--json` 每次都要指定，`--content-limit 1000` 非记忆性参数，每次要重算。

### 4.3 导入入口分散

| 入口 | 适用场景 | 参数模型 |
|------|---------|---------|
| `nmem t create` | 从零创建 | `--title` 必须，`--messages/-m` 或 `--content/-c` |
| `nmem t import` | 从文件导入 | `--file/-f` 或 `--stdin` |
| `nmem t save` | 从 agent 保存 | `--from <host>` 必须 |
| `nmem t sync` | 批量同步 | `--from <host>` + `--apply` |

语义重叠（create vs import vs save vs sync），参数不一致。

### 4.4 搜索质量

- `nmem m search` 语义搜索效果不够好（session 中记录的反馈："搜索效果差"）
- 搜索返回的是 agent-friendly JSON，但 agent 仍需自己决定哪些结果相关

### 4.5 无优雅 fallback

nmem 后端需要运行，且网络可达。当不可用时，当前 daily-recap 流程只能 hard stop 或退化到本地 jsonl 读取——fallback 逻辑散落在 SKILL.md 中而非集中处理。

---

## 5. 已知别名/缩写

nmem CLI 本身支持：

| 全名 | 缩写 |
|------|------|
| `threads` | `t` |
| `memories` | `m` |
| `working-memory` | `wm` |
| `library` | `s`, `lib`, `l` |

**来源**: `nmem --help` 中的 `(alias: ...)` 标注

此外，`--limit` 有一个 `-n` 缩写，`--messages` 在部分子命令中有 `-m` 缩写（但 `t show` 中 `--messages` 已废弃，用 `--limit`）。

---

## 6. 对包装命令（axi）的设计启示

基于以上研究，一个好的包装命令应当：

1. **一键读取完整会话**：`axi t show <id>` 自动分段读取并拼接，不用手动 offset
2. **智能默认参数**：`--json` 默认为 agent 模式，`--content-limit` 根据上下文自动调整
3. **统一导入入口**：合并 `create/import/save/sync` 为一个 `axi t save --from <host>|--file <path>|--messages <json>`
4. **内置 fallback**：nmem 不可用时，自动降级到本地 jsonl/直接 l 查询
5. **简洁的过滤与搜索**：`axi m search "term" --today --label backend` 替代冗长的参数堆叠
6. **记忆快速写入**：`axi m add -t "Title" -c "content" -l tag`，默认 decision 类型 + 默认重要性

---

## 附录 A：session 文件引用

以下 session 文件被分析：

- `/home/cnife/.pi/agent/sessions/--home-cnife-personal_code-skills--/2026-07-14T06-55-06-515Z_019f5f68-6b13-75dd-b5ac-223d24bdeb38.jsonl` — daily-recap 开发，最密集的 nmem 使用模式
- `/home/cnife/.pi/agent/sessions/--home-cnife-personal_code-skills--/2026-07-03T13-45-14-382Z_019f2839-f38e-7821-93c9-9e0bbc433cd0.jsonl` — search-memory skill 开发
- `/home/cnife/.pi/agent/sessions/--home-cnife-personal_code-skills--/2026-07-14T02-26-15-405Z_019f5e72-46ed-75f9-814f-c45795d1dc6d.jsonl` — nmem 后台智能修复
- `/home/cnife/.pi/agent/sessions/--home-cnife-personal_code-nmem-import-pi-sessions--/2026-06-10T08-14-51-428Z_019eb099-3623-72d3-9395-162524c967e5.jsonl` — 导入 pi session 到 nmem
- `/home/cnife/.pi/agent/sessions/--home-cnife-personal_code-nmem-import-pi-sessions--/2026-06-10T09-19-09-610Z_019eb0d4-152a-785a-95b3-369ff729510a.jsonl` — nmem API 测试
- `/home/cnife/.pi/agent/sessions/--home-cnife-personal_code-nmem-import-pi-sessions--/2026-06-11T03-14-54-006Z_019eb4ac-f3b6-7ded-b078-a808cfb8a2e0.jsonl` — 导入工具调研
